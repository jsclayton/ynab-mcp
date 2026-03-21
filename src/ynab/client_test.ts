import { assertEquals, assertRejects } from "@std/testing/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { YnabClient } from "./client.ts";

// ---------------------------------------------------------------------------
// Test helpers: mock globalThis.fetch
// ---------------------------------------------------------------------------

type MockFetchHandler = (
  url: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

let originalFetch: typeof globalThis.fetch;
let mockHandler: MockFetchHandler;

function installMock(handler: MockFetchHandler): void {
  mockHandler = handler;
  globalThis.fetch = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    return mockHandler(input, init);
  };
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("YnabClient", () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -------------------------------------------------------------------------
  // Auth header
  // -------------------------------------------------------------------------

  describe("authentication", () => {
    it("should include Authorization Bearer header on every request", async () => {
      let capturedHeaders: HeadersInit | undefined;

      installMock((_url, init) => {
        capturedHeaders = init?.headers;
        return Promise.resolve(
          jsonResponse({ data: { budgets: [] } }),
        );
      });

      const client = new YnabClient("test-token-abc123");
      await client.getPlans();

      const headers = capturedHeaders as Record<string, string>;
      assertEquals(headers["Authorization"], "Bearer test-token-abc123");
    });
  });

  // -------------------------------------------------------------------------
  // GET request
  // -------------------------------------------------------------------------

  describe("GET requests", () => {
    it("should construct the correct URL and unwrap the response envelope", async () => {
      let capturedUrl = "";
      let capturedMethod = "";

      installMock((url, init) => {
        capturedUrl = url.toString();
        capturedMethod = init?.method ?? "GET";
        return Promise.resolve(
          jsonResponse({
            data: {
              budgets: [
                { id: "budget-1", name: "My Budget" },
              ],
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      const result = await client.getPlans();

      assertEquals(capturedUrl, "https://api.ynab.com/v1/budgets");
      assertEquals(capturedMethod, "GET");
      assertEquals(result.budgets.length, 1);
      assertEquals(result.budgets[0].id, "budget-1");
      assertEquals(result.budgets[0].name, "My Budget");
    });
  });

  // -------------------------------------------------------------------------
  // POST request
  // -------------------------------------------------------------------------

  describe("POST requests", () => {
    it("should serialize body as JSON and set Content-Type header", async () => {
      let capturedBody = "";
      let capturedContentType = "";
      let capturedMethod = "";

      installMock((_url, init) => {
        capturedMethod = init?.method ?? "";
        capturedBody = init?.body as string;
        capturedContentType =
          (init?.headers as Record<string, string>)?.["Content-Type"] ?? "";
        return Promise.resolve(
          jsonResponse({
            data: {
              transaction_ids: ["tx-1"],
              transactions: [],
              duplicate_import_ids: [],
              server_knowledge: 100,
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      const txn = {
        account_id: "acc-1",
        date: "2025-01-15",
        amount: -50000,
      };
      await client.createTransactions("budget-1", [txn]);

      assertEquals(capturedMethod, "POST");
      assertEquals(capturedContentType, "application/json");

      const parsed = JSON.parse(capturedBody);
      assertEquals(parsed.transactions.length, 1);
      assertEquals(parsed.transactions[0].amount, -50000);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("should throw a descriptive auth error on 401", async () => {
      installMock(() =>
        Promise.resolve(
          jsonResponse(
            {
              error: {
                id: "401",
                name: "unauthorized",
                detail: "Token expired",
              },
            },
            401,
          ),
        )
      );

      const client = new YnabClient("bad-token");
      await assertRejects(
        () => client.getPlans(),
        Error,
        "Authentication failed: Token expired",
      );
    });

    it("should throw a not found error on 404", async () => {
      installMock(() =>
        Promise.resolve(
          jsonResponse(
            {
              error: {
                id: "404",
                name: "not_found",
                detail: "Budget not found",
              },
            },
            404,
          ),
        )
      );

      const client = new YnabClient("tok");
      await assertRejects(
        () => client.getPlan("nonexistent"),
        Error,
        "Not found: Budget not found",
      );
    });

    it("should throw a rate limit error on 429 with Retry-After", async () => {
      installMock(() =>
        Promise.resolve(
          jsonResponse(
            {
              error: {
                id: "429",
                name: "too_many_requests",
                detail: "Slow down",
              },
            },
            429,
            { "Retry-After": "30" },
          ),
        )
      );

      const client = new YnabClient("tok");
      await assertRejects(
        () => client.getPlans(),
        Error,
        "Rate limit exceeded: Slow down Retry after 30 seconds.",
      );
    });
  });

  // -------------------------------------------------------------------------
  // getPlans
  // -------------------------------------------------------------------------

  describe("getPlans", () => {
    it("should return the list of budgets", async () => {
      installMock(() =>
        Promise.resolve(
          jsonResponse({
            data: {
              budgets: [
                { id: "b1", name: "Budget One" },
                { id: "b2", name: "Budget Two" },
              ],
            },
          }),
        )
      );

      const client = new YnabClient("tok");
      const result = await client.getPlans();

      assertEquals(result.budgets.length, 2);
      assertEquals(result.budgets[0].name, "Budget One");
      assertEquals(result.budgets[1].name, "Budget Two");
    });
  });

  // -------------------------------------------------------------------------
  // getTransactions with params
  // -------------------------------------------------------------------------

  describe("getTransactions with params", () => {
    it("should append since_date and type as query parameters", async () => {
      let capturedUrl = "";

      installMock((url) => {
        capturedUrl = url.toString();
        return Promise.resolve(
          jsonResponse({
            data: {
              transactions: [],
              server_knowledge: 50,
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      await client.getTransactions("budget-1", {
        since_date: "2025-01-01",
        type: "unapproved",
      });

      const parsed = new URL(capturedUrl);
      assertEquals(parsed.pathname, "/v1/budgets/budget-1/transactions");
      assertEquals(parsed.searchParams.get("since_date"), "2025-01-01");
      assertEquals(parsed.searchParams.get("type"), "unapproved");
    });

    it("should not add query params when none are provided", async () => {
      let capturedUrl = "";

      installMock((url) => {
        capturedUrl = url.toString();
        return Promise.resolve(
          jsonResponse({
            data: {
              transactions: [],
              server_knowledge: 50,
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      await client.getTransactions("budget-1");

      assertEquals(
        capturedUrl,
        "https://api.ynab.com/v1/budgets/budget-1/transactions",
      );
    });
  });

  // -------------------------------------------------------------------------
  // server_knowledge param
  // -------------------------------------------------------------------------

  describe("server_knowledge parameter", () => {
    it("should add last_knowledge_of_server to the URL when provided", async () => {
      let capturedUrl = "";

      installMock((url) => {
        capturedUrl = url.toString();
        return Promise.resolve(
          jsonResponse({
            data: {
              accounts: [],
              server_knowledge: 200,
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      await client.getAccounts("budget-1", 150);

      const parsed = new URL(capturedUrl);
      assertEquals(parsed.pathname, "/v1/budgets/budget-1/accounts");
      assertEquals(parsed.searchParams.get("last_knowledge_of_server"), "150");
    });

    it("should omit last_knowledge_of_server when not provided", async () => {
      let capturedUrl = "";

      installMock((url) => {
        capturedUrl = url.toString();
        return Promise.resolve(
          jsonResponse({
            data: {
              accounts: [],
              server_knowledge: 100,
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      await client.getAccounts("budget-1");

      assertEquals(
        capturedUrl,
        "https://api.ynab.com/v1/budgets/budget-1/accounts",
      );
    });

    it("should add last_knowledge_of_server to categories endpoint", async () => {
      let capturedUrl = "";

      installMock((url) => {
        capturedUrl = url.toString();
        return Promise.resolve(
          jsonResponse({
            data: {
              category_groups: [],
              server_knowledge: 300,
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      await client.getCategories("budget-1", 250);

      const parsed = new URL(capturedUrl);
      assertEquals(
        parsed.searchParams.get("last_knowledge_of_server"),
        "250",
      );
    });

    it("should add last_knowledge_of_server to transactions endpoint", async () => {
      let capturedUrl = "";

      installMock((url) => {
        capturedUrl = url.toString();
        return Promise.resolve(
          jsonResponse({
            data: {
              transactions: [],
              server_knowledge: 400,
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      await client.getTransactions("budget-1", {
        last_knowledge_of_server: 350,
      });

      const parsed = new URL(capturedUrl);
      assertEquals(
        parsed.searchParams.get("last_knowledge_of_server"),
        "350",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Rate limit tracking
  // -------------------------------------------------------------------------

  describe("rate limit tracking", () => {
    it("should track remaining requests from X-Rate-Limit header", async () => {
      installMock(() =>
        Promise.resolve(
          jsonResponse(
            { data: { budgets: [] } },
            200,
            { "X-Rate-Limit": "36/200" },
          ),
        )
      );

      const client = new YnabClient("tok");
      assertEquals(client.getRateLimitRemaining(), null);

      await client.getPlans();
      assertEquals(client.getRateLimitRemaining(), 164);
    });
  });

  // -------------------------------------------------------------------------
  // Additional endpoint coverage
  // -------------------------------------------------------------------------

  describe("additional endpoints", () => {
    it("should call PATCH for updateTransactions", async () => {
      let capturedMethod = "";
      let capturedUrl = "";

      installMock((url, init) => {
        capturedUrl = url.toString();
        capturedMethod = init?.method ?? "";
        return Promise.resolve(
          jsonResponse({
            data: {
              transactions: [],
              server_knowledge: 100,
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      await client.updateTransactions("budget-1", [
        { id: "tx-1", memo: "updated" },
      ]);

      assertEquals(capturedMethod, "PATCH");
      assertEquals(
        capturedUrl,
        "https://api.ynab.com/v1/budgets/budget-1/transactions",
      );
    });

    it("should call DELETE for deleteTransaction", async () => {
      let capturedMethod = "";
      let capturedUrl = "";

      installMock((url, init) => {
        capturedUrl = url.toString();
        capturedMethod = init?.method ?? "";
        return Promise.resolve(
          jsonResponse({
            data: { transaction: { id: "tx-1", deleted: true } },
          }),
        );
      });

      const client = new YnabClient("tok");
      await client.deleteTransaction("budget-1", "tx-1");

      assertEquals(capturedMethod, "DELETE");
      assertEquals(
        capturedUrl,
        "https://api.ynab.com/v1/budgets/budget-1/transactions/tx-1",
      );
    });

    it("should GET scheduled transactions", async () => {
      let capturedUrl = "";

      installMock((url) => {
        capturedUrl = url.toString();
        return Promise.resolve(
          jsonResponse({
            data: {
              scheduled_transactions: [
                { id: "st-1", date_next: "2025-02-01" },
              ],
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      const result = await client.getScheduledTransactions("budget-1");

      assertEquals(
        capturedUrl,
        "https://api.ynab.com/v1/budgets/budget-1/scheduled_transactions",
      );
      assertEquals(result.scheduled_transactions.length, 1);
    });

    it("should throw on createCategory since the API does not support it", () => {
      const client = new YnabClient("tok");
      let threw = false;
      try {
        client.createCategory("budget-1", { name: "New" });
      } catch (e) {
        threw = true;
        assertEquals(e instanceof Error, true);
        assertEquals(
          (e as Error).message.includes("not supported by the YNAB API"),
          true,
        );
      }
      assertEquals(threw, true);
    });

    it("should GET transactions by account", async () => {
      let capturedUrl = "";

      installMock((url) => {
        capturedUrl = url.toString();
        return Promise.resolve(
          jsonResponse({
            data: {
              transactions: [],
              server_knowledge: 10,
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      await client.getTransactionsByAccount("budget-1", "acc-1", {
        since_date: "2025-06-01",
      });

      const parsed = new URL(capturedUrl);
      assertEquals(
        parsed.pathname,
        "/v1/budgets/budget-1/accounts/acc-1/transactions",
      );
      assertEquals(parsed.searchParams.get("since_date"), "2025-06-01");
    });

    it("should GET transactions by category", async () => {
      let capturedUrl = "";

      installMock((url) => {
        capturedUrl = url.toString();
        return Promise.resolve(
          jsonResponse({
            data: {
              transactions: [],
              server_knowledge: 10,
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      await client.getTransactionsByCategory("budget-1", "cat-1");

      assertEquals(
        capturedUrl,
        "https://api.ynab.com/v1/budgets/budget-1/categories/cat-1/transactions",
      );
    });

    it("should GET transactions by payee", async () => {
      let capturedUrl = "";

      installMock((url) => {
        capturedUrl = url.toString();
        return Promise.resolve(
          jsonResponse({
            data: {
              transactions: [],
              server_knowledge: 10,
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      await client.getTransactionsByPayee("budget-1", "payee-1");

      assertEquals(
        capturedUrl,
        "https://api.ynab.com/v1/budgets/budget-1/payees/payee-1/transactions",
      );
    });

    it("should POST importTransactions", async () => {
      let capturedMethod = "";
      let capturedUrl = "";

      installMock((url, init) => {
        capturedUrl = url.toString();
        capturedMethod = init?.method ?? "";
        return Promise.resolve(
          jsonResponse({
            data: { transaction_ids: ["tx-imported-1"] },
          }),
        );
      });

      const client = new YnabClient("tok");
      const result = await client.importTransactions("budget-1");

      assertEquals(capturedMethod, "POST");
      assertEquals(
        capturedUrl,
        "https://api.ynab.com/v1/budgets/budget-1/transactions/import",
      );
      assertEquals(result.transaction_ids, ["tx-imported-1"]);
    });

    it("should GET months list", async () => {
      let capturedUrl = "";

      installMock((url) => {
        capturedUrl = url.toString();
        return Promise.resolve(
          jsonResponse({
            data: {
              months: [{ month: "2025-01-01", income: 500000 }],
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      const result = await client.getMonths("budget-1");

      assertEquals(
        capturedUrl,
        "https://api.ynab.com/v1/budgets/budget-1/months",
      );
      assertEquals(result.months.length, 1);
    });

    it("should GET a single month", async () => {
      let capturedUrl = "";

      installMock((url) => {
        capturedUrl = url.toString();
        return Promise.resolve(
          jsonResponse({
            data: {
              month: {
                month: "2025-03-01",
                income: 600000,
                categories: [],
              },
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      const result = await client.getMonth("budget-1", "2025-03-01");

      assertEquals(
        capturedUrl,
        "https://api.ynab.com/v1/budgets/budget-1/months/2025-03-01",
      );
      assertEquals(result.month.month, "2025-03-01");
    });

    it("should PATCH updatePayee", async () => {
      let capturedMethod = "";
      let capturedUrl = "";
      let capturedBody = "";

      installMock((url, init) => {
        capturedUrl = url.toString();
        capturedMethod = init?.method ?? "";
        capturedBody = init?.body as string;
        return Promise.resolve(
          jsonResponse({
            data: { payee: { id: "payee-1", name: "Renamed" } },
          }),
        );
      });

      const client = new YnabClient("tok");
      await client.updatePayee("budget-1", "payee-1", { name: "Renamed" });

      assertEquals(capturedMethod, "PATCH");
      assertEquals(
        capturedUrl,
        "https://api.ynab.com/v1/budgets/budget-1/payees/payee-1",
      );
      const parsed = JSON.parse(capturedBody);
      assertEquals(parsed.payee.name, "Renamed");
    });

    it("should PATCH updateMonthCategory", async () => {
      let capturedMethod = "";
      let capturedUrl = "";

      installMock((url, init) => {
        capturedUrl = url.toString();
        capturedMethod = init?.method ?? "";
        return Promise.resolve(
          jsonResponse({
            data: { category: { id: "cat-1", budgeted: 100000 } },
          }),
        );
      });

      const client = new YnabClient("tok");
      await client.updateMonthCategory("budget-1", "2025-03-01", "cat-1", {
        budgeted: 100000,
      });

      assertEquals(capturedMethod, "PATCH");
      assertEquals(
        capturedUrl,
        "https://api.ynab.com/v1/budgets/budget-1/months/2025-03-01/categories/cat-1",
      );
    });

    it("should POST createScheduledTransaction", async () => {
      let capturedMethod = "";
      let capturedUrl = "";

      installMock((url, init) => {
        capturedUrl = url.toString();
        capturedMethod = init?.method ?? "";
        return Promise.resolve(
          jsonResponse({
            data: {
              scheduled_transaction: {
                id: "st-new",
                date_next: "2025-04-01",
              },
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      await client.createScheduledTransaction("budget-1", {
        date_first: "2025-04-01",
        frequency: "monthly",
        amount: -25000,
        account_id: "acc-1",
      } as never);

      assertEquals(capturedMethod, "POST");
      assertEquals(
        capturedUrl,
        "https://api.ynab.com/v1/budgets/budget-1/scheduled_transactions",
      );
    });

    it("should PUT updateScheduledTransaction", async () => {
      let capturedMethod = "";
      let capturedUrl = "";

      installMock((url, init) => {
        capturedUrl = url.toString();
        capturedMethod = init?.method ?? "";
        return Promise.resolve(
          jsonResponse({
            data: {
              scheduled_transaction: { id: "st-1", memo: "updated" },
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      await client.updateScheduledTransaction("budget-1", "st-1", {
        memo: "updated",
      } as never);

      assertEquals(capturedMethod, "PUT");
      assertEquals(
        capturedUrl,
        "https://api.ynab.com/v1/budgets/budget-1/scheduled_transactions/st-1",
      );
    });

    it("should DELETE deleteScheduledTransaction", async () => {
      let capturedMethod = "";
      let capturedUrl = "";

      installMock((url, init) => {
        capturedUrl = url.toString();
        capturedMethod = init?.method ?? "";
        return Promise.resolve(
          jsonResponse({
            data: {
              scheduled_transaction: { id: "st-1", deleted: true },
            },
          }),
        );
      });

      const client = new YnabClient("tok");
      await client.deleteScheduledTransaction("budget-1", "st-1");

      assertEquals(capturedMethod, "DELETE");
      assertEquals(
        capturedUrl,
        "https://api.ynab.com/v1/budgets/budget-1/scheduled_transactions/st-1",
      );
    });
  });
});
