import { assertEquals } from "@std/testing/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { YnabClient } from "../ynab/client.ts";
import type { Cache } from "../ynab/cache.ts";
import {
  makeCategory,
  makePayee,
  makePlan,
  makeScheduledTransaction,
  makeTransaction,
  mockFetch,
} from "../testing/helpers.ts";
import { registerMutationTools } from "./mutations.ts";
import { dollarsToMilliunits } from "../ynab/format.ts";

// ---------------------------------------------------------------------------
// Mock cache
// ---------------------------------------------------------------------------

function createMockCache() {
  const invalidated: string[] = [];
  return {
    getCurrencyFormat: () =>
      Promise.resolve({
        iso_code: "USD",
        example_format: "123,456.78",
        decimal_digits: 2,
        decimal_separator: ".",
        symbol_first: true,
        symbol: "$",
        display_symbol: true,
        group_separator: ",",
      }),
    invalidate: (planId: string) => {
      invalidated.push(planId);
    },
    invalidated,
  } as unknown as Cache & { invalidated: string[] };
}

// ---------------------------------------------------------------------------
// Helper to call a registered tool by name
// ---------------------------------------------------------------------------

async function callTool(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: { type: string; text: string }[] }> {
  // Access the server's internal tool registry
  // deno-lint-ignore no-explicit-any
  const s = server as any;
  const tools = s._registeredTools ?? s._tools ?? s.registeredTools ?? s.tools;
  if (!tools) {
    throw new Error("Cannot access server tool registry");
  }
  const tool = tools[toolName] ?? tools.get?.(toolName);
  if (!tool) {
    throw new Error(`Tool '${toolName}' not registered`);
  }
  const cb = tool.callback ?? tool.handler ?? tool.fn;
  if (!cb) {
    throw new Error(`Tool '${toolName}' has no callback`);
  }
  return await cb(args);
}

// ---------------------------------------------------------------------------
// Common setup
// ---------------------------------------------------------------------------

const PLAN_ID = "plan-123";
const PLAN = makePlan({ id: PLAN_ID, name: "Test Budget" });

function setupPlansEndpoint(fetchMock: ReturnType<typeof mockFetch>) {
  fetchMock.mock("/v1/budgets", { data: { budgets: [PLAN] } }, {
    method: "GET",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("modify_transactions", () => {
  let fetchMock: ReturnType<typeof mockFetch>;
  let client: YnabClient;
  let cache: Cache & { invalidated: string[] };
  let server: McpServer;

  beforeEach(() => {
    fetchMock = mockFetch();
    client = new YnabClient("test-token");
    cache = createMockCache();
    server = new McpServer({ name: "test", version: "0.0.1" });
    registerMutationTools(server, client, cache);
    setupPlansEndpoint(fetchMock);
  });

  afterEach(() => {
    fetchMock.restore();
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  it("creates a transaction with dollar-to-milliunit conversion", async () => {
    const createdTxn = makeTransaction({
      date: "2024-03-15",
      amount: -50000,
      payee_name: "Coffee Shop",
      account_name: "Checking",
    });

    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/transactions`,
      {
        data: {
          transaction_ids: [createdTxn.id],
          transactions: [createdTxn],
          duplicate_import_ids: [],
          server_knowledge: 100,
        },
      },
      { method: "POST" },
    );

    const result = await callTool(server, "modify_transactions", {
      plan_id: PLAN_ID,
      action: "create",
      transactions: [
        {
          date: "2024-03-15",
          amount: -50.0,
          account_id: "acct-1",
          payee_name: "Coffee Shop",
        },
      ],
    });

    // Verify dollar-to-milliunit conversion in the API call
    const postCall = fetchMock.calls.find(
      (c) =>
        c.url.includes(`/budgets/${PLAN_ID}/transactions`) &&
        c.init?.method === "POST" &&
        !c.url.includes("import"),
    );
    const body = JSON.parse(postCall!.init!.body as string);
    assertEquals(body.transactions[0].amount, -50000);
    assertEquals(body.transactions[0].date, "2024-03-15");
    assertEquals(body.transactions[0].payee_name, "Coffee Shop");

    const text = result.content[0].text;
    assertEquals(text.includes("Created 1 transaction"), true);
  });

  it("creates a batch of transactions", async () => {
    const txn1 = makeTransaction({ amount: -25000, payee_name: "Store A" });
    const txn2 = makeTransaction({ amount: -75000, payee_name: "Store B" });

    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/transactions`,
      {
        data: {
          transaction_ids: [txn1.id, txn2.id],
          transactions: [txn1, txn2],
          duplicate_import_ids: [],
          server_knowledge: 101,
        },
      },
      { method: "POST" },
    );

    const result = await callTool(server, "modify_transactions", {
      plan_id: PLAN_ID,
      action: "create",
      transactions: [
        { date: "2024-03-15", amount: -25.0, account_id: "acct-1" },
        { date: "2024-03-16", amount: -75.0, account_id: "acct-1" },
      ],
    });

    const postCall = fetchMock.calls.find(
      (c) =>
        c.url.includes(`/budgets/${PLAN_ID}/transactions`) &&
        c.init?.method === "POST" &&
        !c.url.includes("import"),
    );
    const body = JSON.parse(postCall!.init!.body as string);
    assertEquals(body.transactions.length, 2);
    assertEquals(body.transactions[0].amount, -25000);
    assertEquals(body.transactions[1].amount, -75000);

    const text = result.content[0].text;
    assertEquals(text.includes("Created 2 transactions"), true);
  });

  it("returns error when create action has no transactions", async () => {
    const result = await callTool(server, "modify_transactions", {
      plan_id: PLAN_ID,
      action: "create",
    });

    const text = result.content[0].text;
    assertEquals(text.includes("Error"), true);
    assertEquals(text.includes("transactions"), true);
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  it("updates a transaction with only provided fields", async () => {
    const updatedTxn = makeTransaction({
      id: "txn-1",
      amount: -30000,
      memo: "Updated memo",
    });

    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/transactions`,
      {
        data: {
          transactions: [updatedTxn],
          server_knowledge: 102,
        },
      },
      { method: "PATCH" },
    );

    const result = await callTool(server, "modify_transactions", {
      plan_id: PLAN_ID,
      action: "update",
      updates: [
        { id: "txn-1", amount: -30.0, memo: "Updated memo" },
      ],
    });

    const patchCall = fetchMock.calls.find(
      (c) =>
        c.url.includes(`/budgets/${PLAN_ID}/transactions`) &&
        c.init?.method === "PATCH",
    );
    const body = JSON.parse(patchCall!.init!.body as string);
    assertEquals(body.transactions[0].id, "txn-1");
    assertEquals(body.transactions[0].amount, -30000);
    assertEquals(body.transactions[0].memo, "Updated memo");
    // Fields not provided should not be in the body
    assertEquals(body.transactions[0].date, undefined);
    assertEquals(body.transactions[0].payee_name, undefined);

    const text = result.content[0].text;
    assertEquals(text.includes("Updated 1 transaction"), true);
  });

  it("updates transaction cleared status", async () => {
    const updatedTxn = makeTransaction({
      id: "txn-2",
      cleared: "cleared",
    });

    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/transactions`,
      {
        data: {
          transactions: [updatedTxn],
          server_knowledge: 103,
        },
      },
      { method: "PATCH" },
    );

    const result = await callTool(server, "modify_transactions", {
      plan_id: PLAN_ID,
      action: "update",
      updates: [{ id: "txn-2", cleared: "cleared" }],
    });

    const patchCall = fetchMock.calls.find(
      (c) => c.init?.method === "PATCH",
    );
    const body = JSON.parse(patchCall!.init!.body as string);
    assertEquals(body.transactions[0].cleared, "cleared");
    // amount should not be set since it was not provided
    assertEquals(body.transactions[0].amount, undefined);

    const text = result.content[0].text;
    assertEquals(text.includes("Updated 1 transaction"), true);
  });

  it("returns error when update action has no updates", async () => {
    const result = await callTool(server, "modify_transactions", {
      plan_id: PLAN_ID,
      action: "update",
    });

    const text = result.content[0].text;
    assertEquals(text.includes("Error"), true);
    assertEquals(text.includes("updates"), true);
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  it("deletes a transaction", async () => {
    const deletedTxn = makeTransaction({
      id: "txn-del-1",
      date: "2024-03-10",
      amount: -15000,
      payee_name: "Old Store",
    });

    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/transactions/txn-del-1`,
      {
        data: { transaction: deletedTxn },
      },
      { method: "DELETE" },
    );

    const result = await callTool(server, "modify_transactions", {
      plan_id: PLAN_ID,
      action: "delete",
      transaction_id: "txn-del-1",
    });

    const deleteCall = fetchMock.calls.find(
      (c) => c.init?.method === "DELETE",
    );
    assertEquals(
      deleteCall!.url.includes(`/transactions/txn-del-1`),
      true,
    );

    const text = result.content[0].text;
    assertEquals(text.includes("Deleted transaction"), true);
    assertEquals(text.includes("Old Store"), true);
  });

  it("returns error when delete action has no transaction_id", async () => {
    const result = await callTool(server, "modify_transactions", {
      plan_id: PLAN_ID,
      action: "delete",
    });

    const text = result.content[0].text;
    assertEquals(text.includes("Error"), true);
    assertEquals(text.includes("transaction_id"), true);
  });

  // -------------------------------------------------------------------------
  // import
  // -------------------------------------------------------------------------

  it("imports transactions from linked accounts", async () => {
    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/transactions/import`,
      {
        data: { transaction_ids: ["imp-1", "imp-2", "imp-3"] },
      },
      { method: "POST" },
    );

    const result = await callTool(server, "modify_transactions", {
      plan_id: PLAN_ID,
      action: "import",
    });

    const importCall = fetchMock.calls.find(
      (c) =>
        c.url.includes("/transactions/import") &&
        c.init?.method === "POST",
    );
    assertEquals(importCall !== undefined, true);

    const text = result.content[0].text;
    assertEquals(text.includes("Imported 3 transactions"), true);
  });
});

// ---------------------------------------------------------------------------
// modify_budget
// ---------------------------------------------------------------------------

describe("modify_budget", () => {
  let fetchMock: ReturnType<typeof mockFetch>;
  let client: YnabClient;
  let cache: Cache & { invalidated: string[] };
  let server: McpServer;

  beforeEach(() => {
    fetchMock = mockFetch();
    client = new YnabClient("test-token");
    cache = createMockCache();
    server = new McpServer({ name: "test", version: "0.0.1" });
    registerMutationTools(server, client, cache);
    setupPlansEndpoint(fetchMock);
  });

  afterEach(() => {
    fetchMock.restore();
  });

  it("sets budget amount for a category in a month", async () => {
    const cat = makeCategory({
      name: "Groceries",
      budgeted: 300000,
      balance: 150000,
    });

    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/months/2024-03-01/categories/${cat.id}`,
      { data: { category: cat } },
      { method: "PATCH" },
    );

    const result = await callTool(server, "modify_budget", {
      plan_id: PLAN_ID,
      action: "set_amount",
      month: "2024-03-01",
      category_id: cat.id,
      amount: 300.0,
    });

    const patchCall = fetchMock.calls.find(
      (c) =>
        c.url.includes("/months/2024-03-01/categories/") &&
        c.init?.method === "PATCH",
    );
    const body = JSON.parse(patchCall!.init!.body as string);
    assertEquals(body.budgeted, 300000);

    const text = result.content[0].text;
    assertEquals(text.includes("Groceries"), true);
    assertEquals(text.includes("$300.00"), true);
  });

  it("returns error when set_amount is missing required params", async () => {
    // Missing month
    let result = await callTool(server, "modify_budget", {
      plan_id: PLAN_ID,
      action: "set_amount",
      category_id: "cat-1",
      amount: 100,
    });
    assertEquals(result.content[0].text.includes("Error"), true);
    assertEquals(result.content[0].text.includes("month"), true);

    // Missing category_id
    result = await callTool(server, "modify_budget", {
      plan_id: PLAN_ID,
      action: "set_amount",
      month: "2024-03-01",
      amount: 100,
    });
    assertEquals(result.content[0].text.includes("Error"), true);
    assertEquals(result.content[0].text.includes("category_id"), true);

    // Missing amount
    result = await callTool(server, "modify_budget", {
      plan_id: PLAN_ID,
      action: "set_amount",
      month: "2024-03-01",
      category_id: "cat-1",
    });
    assertEquals(result.content[0].text.includes("Error"), true);
    assertEquals(result.content[0].text.includes("amount"), true);
  });

  it("renames a category", async () => {
    const cat = makeCategory({ name: "New Groceries Name" });

    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/categories/${cat.id}`,
      { data: { category: cat } },
      { method: "PATCH" },
    );

    const result = await callTool(server, "modify_budget", {
      plan_id: PLAN_ID,
      action: "update_category",
      category_id: cat.id,
      name: "New Groceries Name",
    });

    const patchCall = fetchMock.calls.find(
      (c) =>
        c.url.includes(`/categories/${cat.id}`) &&
        c.init?.method === "PATCH" &&
        !c.url.includes("/months/"),
    );
    const body = JSON.parse(patchCall!.init!.body as string);
    assertEquals(body.category.name, "New Groceries Name");

    const text = result.content[0].text;
    assertEquals(text.includes("Updated category"), true);
    assertEquals(text.includes("New Groceries Name"), true);
  });

  it("hides a category", async () => {
    const cat = makeCategory({ name: "Old Category", hidden: true });

    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/categories/${cat.id}`,
      { data: { category: cat } },
      { method: "PATCH" },
    );

    const result = await callTool(server, "modify_budget", {
      plan_id: PLAN_ID,
      action: "update_category",
      category_id: cat.id,
      hidden: true,
    });

    const patchCall = fetchMock.calls.find(
      (c) =>
        c.url.includes(`/categories/${cat.id}`) &&
        c.init?.method === "PATCH" &&
        !c.url.includes("/months/"),
    );
    const body = JSON.parse(patchCall!.init!.body as string);
    assertEquals(body.category.hidden, true);

    const text = result.content[0].text;
    assertEquals(text.includes("now hidden"), true);
  });

  it("sets goal target and target date", async () => {
    const cat = makeCategory({
      name: "Vacation",
      goal_type: "TBD",
      goal_target: 2000000,
      goal_target_month: "2024-12-01",
    });

    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/months/2024-03-01/categories/${cat.id}`,
      { data: { category: cat } },
      { method: "PATCH" },
    );

    const result = await callTool(server, "modify_budget", {
      plan_id: PLAN_ID,
      action: "set_goal",
      month: "2024-03-01",
      category_id: cat.id,
      goal_target: 2000.0,
      goal_target_date: "2024-12-01",
    });

    const patchCall = fetchMock.calls.find(
      (c) =>
        c.url.includes("/months/2024-03-01/categories/") &&
        c.init?.method === "PATCH",
    );
    const body = JSON.parse(patchCall!.init!.body as string);
    assertEquals(body.goal_target, 2000000);
    assertEquals(body.goal_target_month, "2024-12-01");

    const text = result.content[0].text;
    assertEquals(text.includes("Vacation"), true);
    assertEquals(text.includes("Target:"), true);
    assertEquals(text.includes("$2,000.00"), true);
    assertEquals(text.includes("2024-12-01"), true);
  });

  it("returns error when update_category has no name or hidden", async () => {
    const result = await callTool(server, "modify_budget", {
      plan_id: PLAN_ID,
      action: "update_category",
      category_id: "cat-1",
    });

    const text = result.content[0].text;
    assertEquals(text.includes("Error"), true);
    assertEquals(text.includes("name"), true);
  });
});

// ---------------------------------------------------------------------------
// modify_scheduled_transactions
// ---------------------------------------------------------------------------

describe("modify_scheduled_transactions", () => {
  let fetchMock: ReturnType<typeof mockFetch>;
  let client: YnabClient;
  let cache: Cache & { invalidated: string[] };
  let server: McpServer;

  beforeEach(() => {
    fetchMock = mockFetch();
    client = new YnabClient("test-token");
    cache = createMockCache();
    server = new McpServer({ name: "test", version: "0.0.1" });
    registerMutationTools(server, client, cache);
    setupPlansEndpoint(fetchMock);
  });

  afterEach(() => {
    fetchMock.restore();
  });

  it("creates a scheduled transaction", async () => {
    const st = makeScheduledTransaction({
      date_first: "2024-04-01",
      date_next: "2024-04-01",
      frequency: "monthly",
      amount: -50000,
      payee_name: "Gym",
    });

    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/scheduled_transactions`,
      { data: { scheduled_transaction: st } },
      { method: "POST" },
    );

    const result = await callTool(server, "modify_scheduled_transactions", {
      plan_id: PLAN_ID,
      action: "create",
      date_first: "2024-04-01",
      frequency: "monthly",
      amount: -50.0,
      account_id: "acct-1",
      payee_name: "Gym",
      category_id: "cat-1",
      memo: "Monthly gym",
    });

    const postCall = fetchMock.calls.find(
      (c) =>
        c.url.includes("/scheduled_transactions") &&
        c.init?.method === "POST",
    );
    const body = JSON.parse(postCall!.init!.body as string);
    assertEquals(body.scheduled_transaction.amount, -50000);
    assertEquals(body.scheduled_transaction.frequency, "monthly");
    assertEquals(body.scheduled_transaction.date_first, "2024-04-01");
    assertEquals(body.scheduled_transaction.account_id, "acct-1");
    assertEquals(body.scheduled_transaction.payee_name, "Gym");
    assertEquals(body.scheduled_transaction.category_id, "cat-1");
    assertEquals(body.scheduled_transaction.memo, "Monthly gym");

    const text = result.content[0].text;
    assertEquals(text.includes("Created scheduled transaction"), true);
    assertEquals(text.includes("Gym"), true);
  });

  it("updates a scheduled transaction with partial fields", async () => {
    const st = makeScheduledTransaction({
      id: "st-1",
      amount: -75000,
      payee_name: "Gym Premium",
      frequency: "monthly",
      date_next: "2024-05-01",
    });

    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/scheduled_transactions/st-1`,
      { data: { scheduled_transaction: st } },
      { method: "PUT" },
    );

    const result = await callTool(server, "modify_scheduled_transactions", {
      plan_id: PLAN_ID,
      action: "update",
      scheduled_transaction_id: "st-1",
      amount: -75.0,
      payee_name: "Gym Premium",
    });

    const putCall = fetchMock.calls.find(
      (c) =>
        c.url.includes("/scheduled_transactions/st-1") &&
        c.init?.method === "PUT",
    );
    const body = JSON.parse(putCall!.init!.body as string);
    assertEquals(body.scheduled_transaction.amount, -75000);
    assertEquals(body.scheduled_transaction.payee_name, "Gym Premium");
    // Fields not provided should not be in the body
    assertEquals(body.scheduled_transaction.frequency, undefined);

    const text = result.content[0].text;
    assertEquals(text.includes("Updated scheduled transaction"), true);
  });

  it("deletes a scheduled transaction", async () => {
    const st = makeScheduledTransaction({
      id: "st-del-1",
      amount: -10000,
      payee_name: "Cancelled Service",
    });

    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/scheduled_transactions/st-del-1`,
      { data: { scheduled_transaction: st } },
      { method: "DELETE" },
    );

    const result = await callTool(server, "modify_scheduled_transactions", {
      plan_id: PLAN_ID,
      action: "delete",
      scheduled_transaction_id: "st-del-1",
    });

    const deleteCall = fetchMock.calls.find(
      (c) =>
        c.url.includes("/scheduled_transactions/st-del-1") &&
        c.init?.method === "DELETE",
    );
    assertEquals(deleteCall !== undefined, true);

    const text = result.content[0].text;
    assertEquals(text.includes("Deleted scheduled transaction"), true);
    assertEquals(text.includes("Cancelled Service"), true);
  });

  it("returns error when create is missing required params", async () => {
    // Missing date_first
    let result = await callTool(server, "modify_scheduled_transactions", {
      plan_id: PLAN_ID,
      action: "create",
      frequency: "monthly",
      amount: -50,
      account_id: "acct-1",
    });
    assertEquals(result.content[0].text.includes("Error"), true);
    assertEquals(result.content[0].text.includes("date_first"), true);

    // Missing frequency
    result = await callTool(server, "modify_scheduled_transactions", {
      plan_id: PLAN_ID,
      action: "create",
      date_first: "2024-04-01",
      amount: -50,
      account_id: "acct-1",
    });
    assertEquals(result.content[0].text.includes("Error"), true);
    assertEquals(result.content[0].text.includes("frequency"), true);

    // Missing amount
    result = await callTool(server, "modify_scheduled_transactions", {
      plan_id: PLAN_ID,
      action: "create",
      date_first: "2024-04-01",
      frequency: "monthly",
      account_id: "acct-1",
    });
    assertEquals(result.content[0].text.includes("Error"), true);
    assertEquals(result.content[0].text.includes("amount"), true);

    // Missing account_id
    result = await callTool(server, "modify_scheduled_transactions", {
      plan_id: PLAN_ID,
      action: "create",
      date_first: "2024-04-01",
      frequency: "monthly",
      amount: -50,
    });
    assertEquals(result.content[0].text.includes("Error"), true);
    assertEquals(result.content[0].text.includes("account_id"), true);
  });
});

// ---------------------------------------------------------------------------
// update_payee
// ---------------------------------------------------------------------------

describe("update_payee", () => {
  let fetchMock: ReturnType<typeof mockFetch>;
  let client: YnabClient;
  let cache: Cache & { invalidated: string[] };
  let server: McpServer;

  beforeEach(() => {
    fetchMock = mockFetch();
    client = new YnabClient("test-token");
    cache = createMockCache();
    server = new McpServer({ name: "test", version: "0.0.1" });
    registerMutationTools(server, client, cache);
    setupPlansEndpoint(fetchMock);
  });

  afterEach(() => {
    fetchMock.restore();
  });

  it("renames a payee", async () => {
    const payee = makePayee({ id: "payee-1", name: "Clean Name" });

    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/payees/payee-1`,
      { data: { payee } },
      { method: "PATCH" },
    );

    const result = await callTool(server, "update_payee", {
      plan_id: PLAN_ID,
      payee_id: "payee-1",
      name: "Clean Name",
    });

    const patchCall = fetchMock.calls.find(
      (c) => c.url.includes("/payees/payee-1") && c.init?.method === "PATCH",
    );
    const body = JSON.parse(patchCall!.init!.body as string);
    assertEquals(body.payee.name, "Clean Name");

    const text = result.content[0].text;
    assertEquals(text.includes("Renamed payee to: Clean Name"), true);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: cache invalidation
// ---------------------------------------------------------------------------

describe("cache invalidation", () => {
  let fetchMock: ReturnType<typeof mockFetch>;
  let client: YnabClient;
  let cache: Cache & { invalidated: string[] };
  let server: McpServer;

  beforeEach(() => {
    fetchMock = mockFetch();
    client = new YnabClient("test-token");
    cache = createMockCache();
    server = new McpServer({ name: "test", version: "0.0.1" });
    registerMutationTools(server, client, cache);
    setupPlansEndpoint(fetchMock);
  });

  afterEach(() => {
    fetchMock.restore();
  });

  it("invalidates cache after creating transactions", async () => {
    const txn = makeTransaction();
    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/transactions`,
      {
        data: {
          transaction_ids: [txn.id],
          transactions: [txn],
          duplicate_import_ids: [],
          server_knowledge: 1,
        },
      },
      { method: "POST" },
    );

    await callTool(server, "modify_transactions", {
      plan_id: PLAN_ID,
      action: "create",
      transactions: [{ date: "2024-01-01", amount: -10, account_id: "a" }],
    });

    assertEquals(cache.invalidated.includes(PLAN_ID), true);
  });

  it("invalidates cache after updating transactions", async () => {
    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/transactions`,
      {
        data: {
          transactions: [makeTransaction({ id: "t1" })],
          server_knowledge: 2,
        },
      },
      { method: "PATCH" },
    );

    await callTool(server, "modify_transactions", {
      plan_id: PLAN_ID,
      action: "update",
      updates: [{ id: "t1", cleared: "cleared" }],
    });

    assertEquals(cache.invalidated.includes(PLAN_ID), true);
  });

  it("invalidates cache after deleting a transaction", async () => {
    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/transactions/t-del`,
      { data: { transaction: makeTransaction({ id: "t-del" }) } },
      { method: "DELETE" },
    );

    await callTool(server, "modify_transactions", {
      plan_id: PLAN_ID,
      action: "delete",
      transaction_id: "t-del",
    });

    assertEquals(cache.invalidated.includes(PLAN_ID), true);
  });

  it("invalidates cache after importing transactions", async () => {
    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/transactions/import`,
      { data: { transaction_ids: [] } },
      { method: "POST" },
    );

    await callTool(server, "modify_transactions", {
      plan_id: PLAN_ID,
      action: "import",
    });

    assertEquals(cache.invalidated.includes(PLAN_ID), true);
  });

  it("invalidates cache after setting budget amount", async () => {
    const cat = makeCategory();
    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/months/2024-03-01/categories/${cat.id}`,
      { data: { category: cat } },
      { method: "PATCH" },
    );

    await callTool(server, "modify_budget", {
      plan_id: PLAN_ID,
      action: "set_amount",
      month: "2024-03-01",
      category_id: cat.id,
      amount: 100,
    });

    assertEquals(cache.invalidated.includes(PLAN_ID), true);
  });

  it("invalidates cache after updating a payee", async () => {
    fetchMock.mock(
      `/v1/budgets/${PLAN_ID}/payees/p1`,
      { data: { payee: makePayee({ id: "p1", name: "New" }) } },
      { method: "PATCH" },
    );

    await callTool(server, "update_payee", {
      plan_id: PLAN_ID,
      payee_id: "p1",
      name: "New",
    });

    assertEquals(cache.invalidated.includes(PLAN_ID), true);
  });
});

// ---------------------------------------------------------------------------
// Dollar to milliunit conversion edge cases
// ---------------------------------------------------------------------------

describe("dollar to milliunit conversion", () => {
  it("converts zero correctly", () => {
    assertEquals(dollarsToMilliunits(0), 0);
  });

  it("converts negative amounts correctly", () => {
    assertEquals(dollarsToMilliunits(-50.0), -50000);
    assertEquals(dollarsToMilliunits(-0.01), -10);
  });

  it("converts positive amounts correctly", () => {
    assertEquals(dollarsToMilliunits(50.0), 50000);
    assertEquals(dollarsToMilliunits(1234.56), 1234560);
  });

  it("rounds fractional cents", () => {
    // 10.999 dollars -> should round to 10999 milliunits
    assertEquals(dollarsToMilliunits(10.999), 10999);
    // 10.9991 -> 10999.1 -> rounds to 10999
    assertEquals(dollarsToMilliunits(10.9991), 10999);
    // 10.9999 -> 10999.9 -> rounds to 11000
    assertEquals(dollarsToMilliunits(10.9999), 11000);
  });

  it("handles large amounts", () => {
    assertEquals(dollarsToMilliunits(999999.99), 999999990);
  });
});
