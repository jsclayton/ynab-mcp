import { assertEquals } from "@std/testing/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { Cache } from "./cache.ts";
import type { DiskIO } from "./cache.ts";
import type { YnabClient } from "./client.ts";
import type {
  Account,
  CategoryGroup,
  CurrencyFormat,
  Payee,
  Plan,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    name: "Checking",
    type: "checking",
    on_budget: true,
    closed: false,
    balance: 100000,
    cleared_balance: 100000,
    uncleared_balance: 0,
    transfer_payee_id: "tp-1",
    deleted: false,
    ...overrides,
  };
}

function makePayee(overrides: Partial<Payee> = {}): Payee {
  return {
    id: "payee-1",
    name: "Grocery Store",
    transfer_account_id: null,
    deleted: false,
    ...overrides,
  };
}

function makeCategoryGroup(
  overrides: Partial<CategoryGroup> = {},
): CategoryGroup {
  return {
    id: "cg-1",
    name: "Monthly Bills",
    hidden: false,
    deleted: false,
    categories: [
      {
        id: "cat-1",
        category_group_id: "cg-1",
        name: "Rent",
        hidden: false,
        budgeted: 1000000,
        activity: -1000000,
        balance: 0,
        goal_type: null,
        goal_target: null,
        goal_target_month: null,
        goal_percentage_complete: null,
        goal_months_to_budget: null,
        goal_under_funded: null,
        goal_overall_funded: null,
        goal_overall_left: null,
        goal_day: null,
        goal_cadence: null,
        goal_cadence_frequency: null,
        goal_creation_month: null,
        goal_needs_whole_amount: null,
        deleted: false,
        note: null,
      },
    ],
    ...overrides,
  };
}

function makeCurrencyFormat(
  overrides: Partial<CurrencyFormat> = {},
): CurrencyFormat {
  return {
    iso_code: "USD",
    example_format: "123,456.78",
    decimal_digits: 2,
    decimal_separator: ".",
    symbol_first: true,
    symbol: "$",
    display_symbol: true,
    group_separator: ",",
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    name: "My Budget",
    last_modified_on: "2026-01-01T00:00:00Z",
    first_month: "2025-01-01",
    last_month: "2026-03-01",
    date_format: { format: "MM/DD/YYYY" },
    currency_format: makeCurrencyFormat(),
    ...overrides,
  };
}

interface MockClientCalls {
  getAccounts: number;
  getCategories: number;
  getPayees: number;
  getPlans: number;
}

interface MockClientOptions {
  accounts?: {
    accounts: Account[];
    server_knowledge: number;
  };
  accountsDelta?: {
    accounts: Account[];
    server_knowledge: number;
  };
  categories?: {
    category_groups: CategoryGroup[];
    server_knowledge: number;
  };
  categoriesDelta?: {
    category_groups: CategoryGroup[];
    server_knowledge: number;
  };
  payees?: {
    payees: Payee[];
    server_knowledge: number;
  };
  payeesDelta?: {
    payees: Payee[];
    server_knowledge: number;
  };
  plans?: {
    budgets: Plan[];
  };
}

function createMockClient(options: MockClientOptions) {
  const calls: MockClientCalls = {
    getAccounts: 0,
    getCategories: 0,
    getPayees: 0,
    getPlans: 0,
  };

  const client = {
    getAccounts: (_planId: string, sk?: number) => {
      calls.getAccounts++;
      if (sk !== undefined && options.accountsDelta) {
        return Promise.resolve(options.accountsDelta);
      }
      return Promise.resolve(
        options.accounts ?? { accounts: [], server_knowledge: 1 },
      );
    },
    getCategories: (_planId: string, sk?: number) => {
      calls.getCategories++;
      if (sk !== undefined && options.categoriesDelta) {
        return Promise.resolve(options.categoriesDelta);
      }
      return Promise.resolve(
        options.categories ?? {
          category_groups: [],
          server_knowledge: 1,
        },
      );
    },
    getPayees: (_planId: string, sk?: number) => {
      calls.getPayees++;
      if (sk !== undefined && options.payeesDelta) {
        return Promise.resolve(options.payeesDelta);
      }
      return Promise.resolve(
        options.payees ?? { payees: [], server_knowledge: 1 },
      );
    },
    getPlans: () => {
      calls.getPlans++;
      return Promise.resolve(options.plans ?? { budgets: [makePlan()] });
    },
  } as unknown as YnabClient;

  return { client, calls };
}

function createMockDiskIO(): DiskIO & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read(path: string): Promise<string | null> {
      return Promise.resolve(files.get(path) ?? null);
    },
    write(path: string, content: string): Promise<void> {
      files.set(path, content);
      return Promise.resolve();
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Cache", () => {
  const PLAN_ID = "plan-1";

  // Save and restore Date.now so we can manipulate time for TTL tests
  let originalDateNow: () => number;
  let currentTime: number;

  beforeEach(() => {
    originalDateNow = Date.now;
    currentTime = 1700000000000;
    Date.now = () => currentTime;
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  // -----------------------------------------------------------------------
  // Accounts
  // -----------------------------------------------------------------------

  describe("getAccounts", () => {
    it("first fetch: calls client and returns data", async () => {
      const account = makeAccount();
      const { client, calls } = createMockClient({
        accounts: { accounts: [account], server_knowledge: 10 },
      });
      const cache = new Cache(client);

      const result = await cache.getAccounts(PLAN_ID);

      assertEquals(result, [account]);
      assertEquals(calls.getAccounts, 1);
    });

    it("second call within TTL: returns cached data without calling client", async () => {
      const account = makeAccount();
      const { client, calls } = createMockClient({
        accounts: { accounts: [account], server_knowledge: 10 },
      });
      const cache = new Cache(client);

      await cache.getAccounts(PLAN_ID);
      const result = await cache.getAccounts(PLAN_ID);

      assertEquals(result, [account]);
      assertEquals(calls.getAccounts, 1);
    });

    it("after TTL: performs delta sync with server_knowledge", async () => {
      const account = makeAccount();
      const updatedAccount = makeAccount({
        id: "acc-1",
        balance: 200000,
      });

      const { client, calls } = createMockClient({
        accounts: { accounts: [account], server_knowledge: 10 },
        accountsDelta: {
          accounts: [updatedAccount],
          server_knowledge: 15,
        },
      });
      const cache = new Cache(client);

      // First fetch
      await cache.getAccounts(PLAN_ID);
      assertEquals(calls.getAccounts, 1);

      // Advance time past TTL
      currentTime += 6 * 60 * 1000;

      // Second fetch — should delta sync
      const result = await cache.getAccounts(PLAN_ID);

      assertEquals(calls.getAccounts, 2);
      assertEquals(result.length, 1);
      assertEquals(result[0].balance, 200000);
    });

    it("delta sync: removes deleted items", async () => {
      const acc1 = makeAccount({ id: "acc-1", name: "Checking" });
      const acc2 = makeAccount({ id: "acc-2", name: "Savings" });

      const { client, calls } = createMockClient({
        accounts: {
          accounts: [acc1, acc2],
          server_knowledge: 10,
        },
        accountsDelta: {
          accounts: [makeAccount({ id: "acc-1", deleted: true })],
          server_knowledge: 15,
        },
      });
      const cache = new Cache(client);

      await cache.getAccounts(PLAN_ID);
      currentTime += 6 * 60 * 1000;

      const result = await cache.getAccounts(PLAN_ID);

      assertEquals(calls.getAccounts, 2);
      assertEquals(result.length, 1);
      assertEquals(result[0].id, "acc-2");
    });

    it("delta sync: adds new items", async () => {
      const acc1 = makeAccount({ id: "acc-1", name: "Checking" });
      const acc2 = makeAccount({ id: "acc-2", name: "Savings" });

      const { client } = createMockClient({
        accounts: {
          accounts: [acc1],
          server_knowledge: 10,
        },
        accountsDelta: {
          accounts: [acc2],
          server_knowledge: 15,
        },
      });
      const cache = new Cache(client);

      await cache.getAccounts(PLAN_ID);
      currentTime += 6 * 60 * 1000;

      const result = await cache.getAccounts(PLAN_ID);

      assertEquals(result.length, 2);
      assertEquals(result[0].id, "acc-1");
      assertEquals(result[1].id, "acc-2");
    });

    it("first fetch: filters out deleted items", async () => {
      const acc1 = makeAccount({ id: "acc-1", deleted: false });
      const acc2 = makeAccount({ id: "acc-2", deleted: true });

      const { client } = createMockClient({
        accounts: {
          accounts: [acc1, acc2],
          server_knowledge: 10,
        },
      });
      const cache = new Cache(client);

      const result = await cache.getAccounts(PLAN_ID);

      assertEquals(result.length, 1);
      assertEquals(result[0].id, "acc-1");
    });
  });

  // -----------------------------------------------------------------------
  // Payees
  // -----------------------------------------------------------------------

  describe("getPayees", () => {
    it("first fetch: calls client and returns data", async () => {
      const payee = makePayee();
      const { client, calls } = createMockClient({
        payees: { payees: [payee], server_knowledge: 5 },
      });
      const cache = new Cache(client);

      const result = await cache.getPayees(PLAN_ID);

      assertEquals(result, [payee]);
      assertEquals(calls.getPayees, 1);
    });

    it("second call within TTL: returns cached data", async () => {
      const payee = makePayee();
      const { client, calls } = createMockClient({
        payees: { payees: [payee], server_knowledge: 5 },
      });
      const cache = new Cache(client);

      await cache.getPayees(PLAN_ID);
      const result = await cache.getPayees(PLAN_ID);

      assertEquals(result, [payee]);
      assertEquals(calls.getPayees, 1);
    });

    it("delta sync: updates existing payees", async () => {
      const payee = makePayee({ id: "payee-1", name: "Old Name" });
      const updatedPayee = makePayee({ id: "payee-1", name: "New Name" });

      const { client } = createMockClient({
        payees: { payees: [payee], server_knowledge: 5 },
        payeesDelta: {
          payees: [updatedPayee],
          server_knowledge: 8,
        },
      });
      const cache = new Cache(client);

      await cache.getPayees(PLAN_ID);
      currentTime += 6 * 60 * 1000;

      const result = await cache.getPayees(PLAN_ID);

      assertEquals(result.length, 1);
      assertEquals(result[0].name, "New Name");
    });

    it("delta sync: removes deleted payees", async () => {
      const p1 = makePayee({ id: "payee-1", name: "Payee A" });
      const p2 = makePayee({ id: "payee-2", name: "Payee B" });

      const { client } = createMockClient({
        payees: { payees: [p1, p2], server_knowledge: 5 },
        payeesDelta: {
          payees: [makePayee({ id: "payee-2", deleted: true })],
          server_knowledge: 8,
        },
      });
      const cache = new Cache(client);

      await cache.getPayees(PLAN_ID);
      currentTime += 6 * 60 * 1000;

      const result = await cache.getPayees(PLAN_ID);

      assertEquals(result.length, 1);
      assertEquals(result[0].id, "payee-1");
    });
  });

  // -----------------------------------------------------------------------
  // Category Groups
  // -----------------------------------------------------------------------

  describe("getCategoryGroups", () => {
    it("first fetch: calls client and returns data", async () => {
      const group = makeCategoryGroup();
      const { client, calls } = createMockClient({
        categories: {
          category_groups: [group],
          server_knowledge: 20,
        },
      });
      const cache = new Cache(client);

      const result = await cache.getCategoryGroups(PLAN_ID);

      assertEquals(result.length, 1);
      assertEquals(result[0].id, "cg-1");
      assertEquals(result[0].categories.length, 1);
      assertEquals(calls.getCategories, 1);
    });

    it("second call within TTL: returns cached data", async () => {
      const group = makeCategoryGroup();
      const { client, calls } = createMockClient({
        categories: {
          category_groups: [group],
          server_knowledge: 20,
        },
      });
      const cache = new Cache(client);

      await cache.getCategoryGroups(PLAN_ID);
      const result = await cache.getCategoryGroups(PLAN_ID);

      assertEquals(result.length, 1);
      assertEquals(calls.getCategories, 1);
    });

    it("delta sync: updates categories within existing groups", async () => {
      const group = makeCategoryGroup();

      const updatedGroup = makeCategoryGroup({
        id: "cg-1",
        categories: [
          {
            id: "cat-1",
            category_group_id: "cg-1",
            name: "Rent (Updated)",
            hidden: false,
            budgeted: 1200000,
            activity: -1200000,
            balance: 0,
            goal_type: null,
            goal_target: null,
            goal_target_month: null,
            goal_percentage_complete: null,
            goal_months_to_budget: null,
            goal_under_funded: null,
            goal_overall_funded: null,
            goal_overall_left: null,
            goal_day: null,
            goal_cadence: null,
            goal_cadence_frequency: null,
            goal_creation_month: null,
            goal_needs_whole_amount: null,
            deleted: false,
            note: null,
          },
        ],
      });

      const { client } = createMockClient({
        categories: {
          category_groups: [group],
          server_knowledge: 20,
        },
        categoriesDelta: {
          category_groups: [updatedGroup],
          server_knowledge: 25,
        },
      });
      const cache = new Cache(client);

      await cache.getCategoryGroups(PLAN_ID);
      currentTime += 6 * 60 * 1000;

      const result = await cache.getCategoryGroups(PLAN_ID);

      assertEquals(result.length, 1);
      assertEquals(result[0].categories[0].name, "Rent (Updated)");
      assertEquals(result[0].categories[0].budgeted, 1200000);
    });

    it("delta sync: adds new category groups", async () => {
      const group1 = makeCategoryGroup({ id: "cg-1", name: "Bills" });
      const group2 = makeCategoryGroup({
        id: "cg-2",
        name: "Savings Goals",
        categories: [],
      });

      const { client } = createMockClient({
        categories: {
          category_groups: [group1],
          server_knowledge: 20,
        },
        categoriesDelta: {
          category_groups: [group2],
          server_knowledge: 25,
        },
      });
      const cache = new Cache(client);

      await cache.getCategoryGroups(PLAN_ID);
      currentTime += 6 * 60 * 1000;

      const result = await cache.getCategoryGroups(PLAN_ID);

      assertEquals(result.length, 2);
    });

    it("delta sync: removes deleted groups", async () => {
      const group1 = makeCategoryGroup({ id: "cg-1", name: "Bills" });
      const group2 = makeCategoryGroup({
        id: "cg-2",
        name: "Fun Money",
        categories: [],
      });

      const { client } = createMockClient({
        categories: {
          category_groups: [group1, group2],
          server_knowledge: 20,
        },
        categoriesDelta: {
          category_groups: [
            makeCategoryGroup({
              id: "cg-2",
              deleted: true,
              categories: [],
            }),
          ],
          server_knowledge: 25,
        },
      });
      const cache = new Cache(client);

      await cache.getCategoryGroups(PLAN_ID);
      currentTime += 6 * 60 * 1000;

      const result = await cache.getCategoryGroups(PLAN_ID);

      assertEquals(result.length, 1);
      assertEquals(result[0].id, "cg-1");
    });

    it("delta sync: removes deleted categories within a group", async () => {
      const group = makeCategoryGroup({
        id: "cg-1",
        categories: [
          {
            id: "cat-1",
            category_group_id: "cg-1",
            name: "Rent",
            hidden: false,
            budgeted: 0,
            activity: 0,
            balance: 0,
            goal_type: null,
            goal_target: null,
            goal_target_month: null,
            goal_percentage_complete: null,
            goal_months_to_budget: null,
            goal_under_funded: null,
            goal_overall_funded: null,
            goal_overall_left: null,
            goal_day: null,
            goal_cadence: null,
            goal_cadence_frequency: null,
            goal_creation_month: null,
            goal_needs_whole_amount: null,
            deleted: false,
            note: null,
          },
          {
            id: "cat-2",
            category_group_id: "cg-1",
            name: "Electric",
            hidden: false,
            budgeted: 0,
            activity: 0,
            balance: 0,
            goal_type: null,
            goal_target: null,
            goal_target_month: null,
            goal_percentage_complete: null,
            goal_months_to_budget: null,
            goal_under_funded: null,
            goal_overall_funded: null,
            goal_overall_left: null,
            goal_day: null,
            goal_cadence: null,
            goal_cadence_frequency: null,
            goal_creation_month: null,
            goal_needs_whole_amount: null,
            deleted: false,
            note: null,
          },
        ],
      });

      const { client } = createMockClient({
        categories: {
          category_groups: [group],
          server_knowledge: 20,
        },
        categoriesDelta: {
          category_groups: [
            makeCategoryGroup({
              id: "cg-1",
              categories: [
                {
                  id: "cat-2",
                  category_group_id: "cg-1",
                  name: "Electric",
                  hidden: false,
                  budgeted: 0,
                  activity: 0,
                  balance: 0,
                  goal_type: null,
                  goal_target: null,
                  goal_target_month: null,
                  goal_percentage_complete: null,
                  goal_months_to_budget: null,
                  goal_under_funded: null,
                  goal_overall_funded: null,
                  goal_overall_left: null,
                  goal_day: null,
                  goal_cadence: null,
                  goal_cadence_frequency: null,
                  goal_creation_month: null,
                  goal_needs_whole_amount: null,
                  deleted: true,
                  note: null,
                },
              ],
            }),
          ],
          server_knowledge: 25,
        },
      });
      const cache = new Cache(client);

      await cache.getCategoryGroups(PLAN_ID);
      currentTime += 6 * 60 * 1000;

      const result = await cache.getCategoryGroups(PLAN_ID);

      assertEquals(result[0].categories.length, 1);
      assertEquals(result[0].categories[0].id, "cat-1");
    });

    it("first fetch: filters out deleted groups and categories", async () => {
      const activeGroup = makeCategoryGroup({ id: "cg-1", name: "Active" });
      const deletedGroup = makeCategoryGroup({
        id: "cg-2",
        name: "Deleted",
        deleted: true,
        categories: [],
      });
      const groupWithDeletedCat = makeCategoryGroup({
        id: "cg-3",
        name: "Mixed",
        categories: [
          {
            id: "cat-alive",
            category_group_id: "cg-3",
            name: "Alive",
            hidden: false,
            budgeted: 0,
            activity: 0,
            balance: 0,
            goal_type: null,
            goal_target: null,
            goal_target_month: null,
            goal_percentage_complete: null,
            goal_months_to_budget: null,
            goal_under_funded: null,
            goal_overall_funded: null,
            goal_overall_left: null,
            goal_day: null,
            goal_cadence: null,
            goal_cadence_frequency: null,
            goal_creation_month: null,
            goal_needs_whole_amount: null,
            deleted: false,
            note: null,
          },
          {
            id: "cat-dead",
            category_group_id: "cg-3",
            name: "Dead",
            hidden: false,
            budgeted: 0,
            activity: 0,
            balance: 0,
            goal_type: null,
            goal_target: null,
            goal_target_month: null,
            goal_percentage_complete: null,
            goal_months_to_budget: null,
            goal_under_funded: null,
            goal_overall_funded: null,
            goal_overall_left: null,
            goal_day: null,
            goal_cadence: null,
            goal_cadence_frequency: null,
            goal_creation_month: null,
            goal_needs_whole_amount: null,
            deleted: true,
            note: null,
          },
        ],
      });

      const { client } = createMockClient({
        categories: {
          category_groups: [activeGroup, deletedGroup, groupWithDeletedCat],
          server_knowledge: 20,
        },
      });
      const cache = new Cache(client);

      const result = await cache.getCategoryGroups(PLAN_ID);

      assertEquals(result.length, 2);
      assertEquals(result[0].id, "cg-1");
      assertEquals(result[1].id, "cg-3");
      assertEquals(result[1].categories.length, 1);
      assertEquals(result[1].categories[0].id, "cat-alive");
    });
  });

  // -----------------------------------------------------------------------
  // Currency Format
  // -----------------------------------------------------------------------

  describe("getCurrencyFormat", () => {
    it("fetches currency format from plans", async () => {
      const plan = makePlan({ id: PLAN_ID });
      const { client, calls } = createMockClient({
        plans: { budgets: [plan] },
      });
      const cache = new Cache(client);

      const result = await cache.getCurrencyFormat(PLAN_ID);

      assertEquals(result.iso_code, "USD");
      assertEquals(result.symbol, "$");
      assertEquals(calls.getPlans, 1);
    });

    it("caches currency format after first fetch", async () => {
      const plan = makePlan({ id: PLAN_ID });
      const { client, calls } = createMockClient({
        plans: { budgets: [plan] },
      });
      const cache = new Cache(client);

      await cache.getCurrencyFormat(PLAN_ID);
      await cache.getCurrencyFormat(PLAN_ID);

      assertEquals(calls.getPlans, 1);
    });

    it("throws when plan not found", async () => {
      const { client } = createMockClient({
        plans: { budgets: [makePlan({ id: "other-plan" })] },
      });
      const cache = new Cache(client);

      let error: Error | null = null;
      try {
        await cache.getCurrencyFormat(PLAN_ID);
      } catch (e) {
        error = e as Error;
      }

      assertEquals(error !== null, true);
      assertEquals(error!.message, `Plan ${PLAN_ID} not found`);
    });
  });

  // -----------------------------------------------------------------------
  // Invalidation
  // -----------------------------------------------------------------------

  describe("invalidate", () => {
    it("forces fresh fetch on next access", async () => {
      const account = makeAccount();
      const { client, calls } = createMockClient({
        accounts: { accounts: [account], server_knowledge: 10 },
      });
      const cache = new Cache(client);

      // First fetch
      await cache.getAccounts(PLAN_ID);
      assertEquals(calls.getAccounts, 1);

      // Invalidate — should force refetch even within TTL
      cache.invalidate(PLAN_ID);

      // Since lastFetched is now 0, the TTL check (now - 0 > TTL) will be true
      // and it will do a delta sync
      await cache.getAccounts(PLAN_ID);
      assertEquals(calls.getAccounts, 2);
    });

    it("no-op when plan has never been cached", () => {
      const { client } = createMockClient({});
      const cache = new Cache(client);

      // Should not throw
      cache.invalidate("nonexistent-plan");
    });
  });

  // -----------------------------------------------------------------------
  // Disk persistence
  // -----------------------------------------------------------------------

  describe("disk persistence", () => {
    it("saves cache to disk after fetching", async () => {
      const account = makeAccount();
      const { client } = createMockClient({
        accounts: { accounts: [account], server_knowledge: 10 },
      });
      const diskIO = createMockDiskIO();
      const cache = new Cache(client, "/tmp/cache", diskIO);

      await cache.getAccounts(PLAN_ID);

      const filePath = `/tmp/cache/${PLAN_ID}.json`;
      assertEquals(diskIO.files.has(filePath), true);

      const saved = JSON.parse(diskIO.files.get(filePath)!);
      assertEquals(saved.accounts.length, 1);
      assertEquals(saved.accounts[0].id, "acc-1");
      assertEquals(saved.serverKnowledge.accounts, 10);
    });

    it("loads cache from disk on first access", async () => {
      const diskIO = createMockDiskIO();
      const filePath = `/tmp/cache/${PLAN_ID}.json`;
      const savedData = {
        accounts: [makeAccount()],
        categoryGroups: [],
        payees: [],
        months: [],
        serverKnowledge: {
          accounts: 10,
          categories: undefined,
          payees: undefined,
        },
        lastFetched: currentTime, // within TTL
      };
      diskIO.files.set(filePath, JSON.stringify(savedData));

      const { client, calls } = createMockClient({});
      const cache = new Cache(client, "/tmp/cache", diskIO);

      const result = await cache.getAccounts(PLAN_ID);

      // Should return data from disk without calling client
      assertEquals(result.length, 1);
      assertEquals(result[0].id, "acc-1");
      assertEquals(calls.getAccounts, 0);
    });

    it("does not use disk when cachePath is not set", async () => {
      const account = makeAccount();
      const { client } = createMockClient({
        accounts: { accounts: [account], server_knowledge: 10 },
      });
      const diskIO = createMockDiskIO();
      // No cachePath provided
      const cache = new Cache(client, undefined, diskIO);

      await cache.getAccounts(PLAN_ID);

      assertEquals(diskIO.files.size, 0);
    });

    it("gracefully handles corrupt disk data", async () => {
      const diskIO = createMockDiskIO();
      const filePath = `/tmp/cache/${PLAN_ID}.json`;
      diskIO.files.set(filePath, "not valid json{{{");

      const account = makeAccount();
      const { client, calls } = createMockClient({
        accounts: { accounts: [account], server_knowledge: 10 },
      });
      const cache = new Cache(client, "/tmp/cache", diskIO);

      // Should fall back to fetching from client
      const result = await cache.getAccounts(PLAN_ID);

      assertEquals(result.length, 1);
      assertEquals(calls.getAccounts, 1);
    });

    it("does not persist currencyFormat to disk", async () => {
      const account = makeAccount();
      const plan = makePlan({ id: PLAN_ID });
      const { client } = createMockClient({
        accounts: { accounts: [account], server_knowledge: 10 },
        plans: { budgets: [plan] },
      });
      const diskIO = createMockDiskIO();
      const cache = new Cache(client, "/tmp/cache", diskIO);

      await cache.getAccounts(PLAN_ID);
      await cache.getCurrencyFormat(PLAN_ID);

      const filePath = `/tmp/cache/${PLAN_ID}.json`;
      const saved = JSON.parse(diskIO.files.get(filePath)!);
      assertEquals(saved.currencyFormat, undefined);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-resource TTL behavior
  // -----------------------------------------------------------------------

  describe("TTL behavior across resources", () => {
    it("each resource type tracks independently via server_knowledge", async () => {
      const account = makeAccount();
      const payee = makePayee();

      const { client, calls } = createMockClient({
        accounts: { accounts: [account], server_knowledge: 10 },
        payees: { payees: [payee], server_knowledge: 5 },
      });
      const cache = new Cache(client);

      // Fetch accounts
      await cache.getAccounts(PLAN_ID);
      assertEquals(calls.getAccounts, 1);
      assertEquals(calls.getPayees, 0);

      // Fetch payees
      await cache.getPayees(PLAN_ID);
      assertEquals(calls.getPayees, 1);

      // Both should be cached within TTL
      await cache.getAccounts(PLAN_ID);
      await cache.getPayees(PLAN_ID);
      assertEquals(calls.getAccounts, 1);
      assertEquals(calls.getPayees, 1);
    });
  });

  // -----------------------------------------------------------------------
  // Multiple plans
  // -----------------------------------------------------------------------

  describe("multiple plans", () => {
    it("maintains separate caches per plan", async () => {
      const acc1 = makeAccount({ id: "acc-1", name: "Plan1 Account" });
      const acc2 = makeAccount({ id: "acc-2", name: "Plan2 Account" });

      let callCount = 0;
      const client = {
        getAccounts: (planId: string, _sk?: number) => {
          callCount++;
          if (planId === "plan-a") {
            return Promise.resolve({ accounts: [acc1], server_knowledge: 10 });
          }
          return Promise.resolve({ accounts: [acc2], server_knowledge: 20 });
        },
        getCategories: () =>
          Promise.resolve({
            category_groups: [],
            server_knowledge: 1,
          }),
        getPayees: () => Promise.resolve({ payees: [], server_knowledge: 1 }),
        getPlans: () => Promise.resolve({ budgets: [] }),
      } as unknown as YnabClient;

      const cache = new Cache(client);

      const result1 = await cache.getAccounts("plan-a");
      const result2 = await cache.getAccounts("plan-b");

      assertEquals(result1[0].name, "Plan1 Account");
      assertEquals(result2[0].name, "Plan2 Account");
      assertEquals(callCount, 2);

      // Both cached within TTL
      await cache.getAccounts("plan-a");
      await cache.getAccounts("plan-b");
      assertEquals(callCount, 2);

      // Invalidate one plan
      cache.invalidate("plan-a");
      await cache.getAccounts("plan-a");
      await cache.getAccounts("plan-b");
      assertEquals(callCount, 3); // Only plan-a refetched
    });
  });
});
