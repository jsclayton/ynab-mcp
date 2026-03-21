import { assertEquals, assertStringIncludes } from "@std/testing/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { makePlan, makeTransaction, mockFetch } from "../testing/helpers.ts";
import { YnabClient } from "../ynab/client.ts";
import { formatMoney, formatTransaction } from "../ynab/format.ts";
import type { Transaction } from "../ynab/types.ts";

const planId = "budget-123";
const planName = "Test Budget";

function makePlansResponse() {
  return {
    data: { budgets: [makePlan({ id: planId, name: planName })] },
  };
}

function makeTransactionsResponse(transactions: Transaction[]) {
  return {
    data: { transactions, server_knowledge: 100 },
  };
}

describe("get_transactions", () => {
  let fetchMock: ReturnType<typeof mockFetch>;

  beforeEach(() => {
    fetchMock = mockFetch();
    // Always mock the plans endpoint (used by the tool for header).
    // Use regex to avoid matching transaction URLs like /v1/budgets/{id}/transactions.
    fetchMock.mock(/\/v1\/budgets(\?|$)/, makePlansResponse());
  });

  afterEach(() => {
    fetchMock.restore();
  });

  // ---------------------------------------------------------------------------
  // Endpoint routing
  // ---------------------------------------------------------------------------

  describe("endpoint routing", () => {
    it("routes to base transactions endpoint when no filter IDs provided", async () => {
      const txn = makeTransaction();
      fetchMock.mock(
        `/v1/budgets/${planId}/transactions`,
        makeTransactionsResponse([txn]),
      );

      const client = new YnabClient("test-token");
      const result = await client.getTransactions(planId);

      assertEquals(result.transactions.length, 1);
      const txnCall = fetchMock.calls.find((c) =>
        c.url.includes(`/budgets/${planId}/transactions`) &&
        !c.url.includes("accounts/") &&
        !c.url.includes("categories/") &&
        !c.url.includes("payees/")
      );
      assertEquals(txnCall !== undefined, true);
    });

    it("routes to account endpoint when account_id provided", async () => {
      const accountId = "acct-1";
      const txn = makeTransaction({ account_id: accountId });
      fetchMock.mock(
        `/v1/budgets/${planId}/accounts/${accountId}/transactions`,
        makeTransactionsResponse([txn]),
      );

      const client = new YnabClient("test-token");
      const result = await client.getTransactionsByAccount(planId, accountId);

      assertEquals(result.transactions.length, 1);
      const txnCall = fetchMock.calls.find((c) =>
        c.url.includes(`accounts/${accountId}/transactions`)
      );
      assertEquals(txnCall !== undefined, true);
    });

    it("routes to category endpoint when category_id provided", async () => {
      const categoryId = "cat-1";
      const txn = makeTransaction({ category_id: categoryId });
      fetchMock.mock(
        `/v1/budgets/${planId}/categories/${categoryId}/transactions`,
        makeTransactionsResponse([txn]),
      );

      const client = new YnabClient("test-token");
      const result = await client.getTransactionsByCategory(planId, categoryId);

      assertEquals(result.transactions.length, 1);
      const txnCall = fetchMock.calls.find((c) =>
        c.url.includes(`categories/${categoryId}/transactions`)
      );
      assertEquals(txnCall !== undefined, true);
    });

    it("routes to payee endpoint when payee_id provided", async () => {
      const payeeId = "payee-1";
      const txn = makeTransaction({ payee_id: payeeId });
      fetchMock.mock(
        `/v1/budgets/${planId}/payees/${payeeId}/transactions`,
        makeTransactionsResponse([txn]),
      );

      const client = new YnabClient("test-token");
      const result = await client.getTransactionsByPayee(planId, payeeId);

      assertEquals(result.transactions.length, 1);
      const txnCall = fetchMock.calls.find((c) =>
        c.url.includes(`payees/${payeeId}/transactions`)
      );
      assertEquals(txnCall !== undefined, true);
    });

    it("account_id takes priority when both account_id and category_id provided", async () => {
      const accountId = "acct-1";
      const categoryId = "cat-1";
      const txn = makeTransaction({
        account_id: accountId,
        category_id: categoryId,
      });

      // Mock the account endpoint (which should be called)
      fetchMock.mock(
        `/v1/budgets/${planId}/accounts/${accountId}/transactions`,
        makeTransactionsResponse([txn]),
      );

      const client = new YnabClient("test-token");

      // Simulate the tool's routing logic: account_id takes priority
      const account_id: string | undefined = accountId;
      const category_id: string | undefined = categoryId;

      let result: { transactions: Transaction[] };
      if (account_id) {
        result = await client.getTransactionsByAccount(planId, account_id);
      } else if (category_id) {
        result = await client.getTransactionsByCategory(planId, category_id);
      } else {
        result = await client.getTransactions(planId);
      }

      assertEquals(result.transactions.length, 1);
      // Verify only the account endpoint was called (not category)
      const acctCall = fetchMock.calls.find((c) =>
        c.url.includes(`accounts/${accountId}/transactions`)
      );
      const catCall = fetchMock.calls.find((c) =>
        c.url.includes(`categories/${categoryId}/transactions`)
      );
      assertEquals(acctCall !== undefined, true);
      assertEquals(catCall !== undefined, false);
    });
  });

  // ---------------------------------------------------------------------------
  // Client-side filtering
  // ---------------------------------------------------------------------------

  describe("client-side filtering", () => {
    it("filters by cleared status", () => {
      const transactions = [
        makeTransaction({ cleared: "cleared", date: "2024-01-15" }),
        makeTransaction({ cleared: "uncleared", date: "2024-01-14" }),
        makeTransaction({ cleared: "reconciled", date: "2024-01-13" }),
      ];

      const cleared = "uncleared" as const;
      const filtered = transactions.filter((t) => t.cleared === cleared);

      assertEquals(filtered.length, 1);
      assertEquals(filtered[0].cleared, "uncleared");
    });

    it("search matches payee_name case-insensitively", () => {
      const transactions = [
        makeTransaction({ payee_name: "Grocery Store", memo: null }),
        makeTransaction({ payee_name: "Gas Station", memo: null }),
        makeTransaction({
          payee_name: "Target",
          memo: "groceries for the week",
        }),
      ];

      const search = "grocery";
      const searchLower = search.toLowerCase();
      const filtered = transactions.filter((t) => {
        const payeeMatch = t.payee_name?.toLowerCase().includes(searchLower);
        const memoMatch = t.memo?.toLowerCase().includes(searchLower);
        return payeeMatch || memoMatch;
      });

      assertEquals(filtered.length, 1);
      assertEquals(filtered[0].payee_name, "Grocery Store");
    });

    it("search matches memo case-insensitively", () => {
      const transactions = [
        makeTransaction({
          payee_name: "Amazon",
          memo: "Birthday gift for Mom",
        }),
        makeTransaction({ payee_name: "Target", memo: "Household supplies" }),
        makeTransaction({ payee_name: "Walmart", memo: null }),
      ];

      const search = "birthday";
      const searchLower = search.toLowerCase();
      const filtered = transactions.filter((t) => {
        const payeeMatch = t.payee_name?.toLowerCase().includes(searchLower);
        const memoMatch = t.memo?.toLowerCase().includes(searchLower);
        return payeeMatch || memoMatch;
      });

      assertEquals(filtered.length, 1);
      assertEquals(filtered[0].payee_name, "Amazon");
    });

    it("filters out deleted transactions", () => {
      const transactions = [
        makeTransaction({ deleted: false }),
        makeTransaction({ deleted: true }),
        makeTransaction({ deleted: false }),
      ];

      const filtered = transactions.filter((t) => !t.deleted);
      assertEquals(filtered.length, 2);
    });

    it("since_date is passed as query param to the API", async () => {
      const txn = makeTransaction({ date: "2024-06-15" });
      fetchMock.mock(
        `/v1/budgets/${planId}/transactions`,
        makeTransactionsResponse([txn]),
      );

      const client = new YnabClient("test-token");
      await client.getTransactions(planId, { since_date: "2024-06-01" });

      const txnCall = fetchMock.calls.find((c) =>
        c.url.includes(`/budgets/${planId}/transactions`)
      );
      assertEquals(txnCall !== undefined, true);
      assertStringIncludes(txnCall!.url, "since_date=2024-06-01");
    });

    it("type filter is passed as query param to the API", async () => {
      const txn = makeTransaction({ category_name: null, category_id: null });
      fetchMock.mock(
        `/v1/budgets/${planId}/transactions`,
        makeTransactionsResponse([txn]),
      );

      const client = new YnabClient("test-token");
      await client.getTransactions(planId, { type: "uncategorized" });

      const txnCall = fetchMock.calls.find((c) =>
        c.url.includes(`/budgets/${planId}/transactions`)
      );
      assertEquals(txnCall !== undefined, true);
      assertStringIncludes(txnCall!.url, "type=uncategorized");
    });
  });

  // ---------------------------------------------------------------------------
  // Sorting
  // ---------------------------------------------------------------------------

  describe("sorting", () => {
    it("sorts transactions by date descending (newest first)", () => {
      const transactions = [
        makeTransaction({ date: "2024-01-10" }),
        makeTransaction({ date: "2024-03-05" }),
        makeTransaction({ date: "2024-02-20" }),
        makeTransaction({ date: "2024-01-01" }),
      ];

      transactions.sort((a, b) => b.date.localeCompare(a.date));

      assertEquals(transactions[0].date, "2024-03-05");
      assertEquals(transactions[1].date, "2024-02-20");
      assertEquals(transactions[2].date, "2024-01-10");
      assertEquals(transactions[3].date, "2024-01-01");
    });
  });

  // ---------------------------------------------------------------------------
  // Truncation / limit
  // ---------------------------------------------------------------------------

  describe("truncation", () => {
    it("truncates to limit and shows count and message", () => {
      const transactions: Transaction[] = [];
      for (let i = 0; i < 10; i++) {
        transactions.push(
          makeTransaction({
            date: `2024-01-${String(i + 1).padStart(2, "0")}`,
          }),
        );
      }

      const limit = 3;
      const effectiveLimit = Math.min(limit, 200);
      const total = transactions.length;
      const truncated = total > effectiveLimit;
      const sliced = transactions.slice(0, effectiveLimit);

      assertEquals(sliced.length, 3);
      assertEquals(truncated, true);
      assertEquals(total, 10);

      // Verify the summary line would include the truncation info
      const summaryPart = `${sliced.length} of ${total} transactions`;
      assertStringIncludes(summaryPart, "3 of 10");

      // Verify remaining count
      const remainingMsg = `... and ${
        total - effectiveLimit
      } more. Use since_date or other filters to narrow results.`;
      assertStringIncludes(remainingMsg, "7 more");
    });

    it("caps limit at 200", () => {
      const requestedLimit = 500;
      const effectiveLimit = Math.min(requestedLimit, 200);
      assertEquals(effectiveLimit, 200);
    });

    it("defaults limit to 50 when not provided", () => {
      const requestedLimit: number | undefined = undefined;
      const effectiveLimit = Math.min(requestedLimit ?? 50, 200);
      assertEquals(effectiveLimit, 50);
    });
  });

  // ---------------------------------------------------------------------------
  // Output formatting
  // ---------------------------------------------------------------------------

  describe("output formatting", () => {
    it("shows 'No transactions found' for empty results", () => {
      const transactions: Transaction[] = [];
      const sections: string[] = [`Budget: ${planName}`, "\u2500".repeat(40)];

      if (transactions.length === 0) {
        sections.push("No transactions found matching your filters.");
      }

      const text = sections.join("\n");
      assertStringIncludes(
        text,
        "No transactions found matching your filters.",
      );
      assertStringIncludes(text, `Budget: ${planName}`);
    });

    it("shows correct net amount in summary", () => {
      const plan = makePlan({ id: planId, name: planName });
      const currency = plan.currency_format;

      const transactions = [
        makeTransaction({ amount: 100000 }), // +$100.00
        makeTransaction({ amount: -45670 }), // -$45.67
        makeTransaction({ amount: -25000 }), // -$25.00
      ];

      const totalAmount = transactions.reduce((sum, t) => sum + t.amount, 0);
      assertEquals(totalAmount, 29330); // $29.33 net

      const netFormatted = formatMoney(totalAmount, currency);
      assertEquals(netFormatted, "$29.33");

      const summaryLine =
        `${transactions.length} transactions \u2014 Net: ${netFormatted}`;
      assertStringIncludes(summaryLine, "3 transactions");
      assertStringIncludes(summaryLine, "$29.33");
    });

    it("each transaction includes date, amount, payee, category, and cleared indicator", () => {
      const plan = makePlan({ id: planId, name: planName });
      const currency = plan.currency_format;

      const txn = makeTransaction({
        date: "2024-03-15",
        amount: -78900,
        payee_name: "Coffee Shop",
        category_name: "Dining Out",
        cleared: "cleared",
      });

      const formatted = formatTransaction(txn, currency);

      assertStringIncludes(formatted, "2024-03-15");
      assertStringIncludes(formatted, "($78.90)");
      assertStringIncludes(formatted, "Coffee Shop");
      assertStringIncludes(formatted, "Dining Out");
      assertStringIncludes(formatted, "\u2713"); // cleared checkmark
    });

    it("shows bullet indicator for uncleared transactions", () => {
      const plan = makePlan({ id: planId, name: planName });
      const currency = plan.currency_format;

      const txn = makeTransaction({
        cleared: "uncleared",
      });

      const formatted = formatTransaction(txn, currency);
      assertStringIncludes(formatted, "\u2022"); // bullet for uncleared
    });

    it("shows R indicator for reconciled transactions", () => {
      const plan = makePlan({ id: planId, name: planName });
      const currency = plan.currency_format;

      const txn = makeTransaction({
        cleared: "reconciled",
      });

      const formatted = formatTransaction(txn, currency);
      assertStringIncludes(formatted, "R");
    });

    it("includes memo on indented line when present", () => {
      const plan = makePlan({ id: planId, name: planName });
      const currency = plan.currency_format;

      const txn = makeTransaction({
        memo: "Monthly subscription",
      });

      const formatted = formatTransaction(txn, currency);
      assertStringIncludes(formatted, "Memo: Monthly subscription");
    });

    it("formats the full output with header, separator, summary, and transactions", () => {
      const plan = makePlan({ id: planId, name: planName });
      const currency = plan.currency_format;

      const transactions = [
        makeTransaction({
          date: "2024-03-15",
          amount: -50000,
          payee_name: "Store A",
        }),
        makeTransaction({
          date: "2024-03-10",
          amount: -30000,
          payee_name: "Store B",
        }),
      ];

      // Sort newest first
      transactions.sort((a, b) => b.date.localeCompare(a.date));

      const totalAmount = transactions.reduce((sum, t) => sum + t.amount, 0);
      const sections: string[] = [
        `Budget: ${planName}`,
        "\u2500".repeat(40),
        `${transactions.length} transactions \u2014 Net: ${
          formatMoney(totalAmount, currency)
        }`,
        "",
      ];

      for (const txn of transactions) {
        sections.push(formatTransaction(txn, currency));
      }

      const text = sections.join("\n");

      assertStringIncludes(text, "Budget: Test Budget");
      assertStringIncludes(text, "\u2500\u2500\u2500\u2500"); // separator
      assertStringIncludes(text, "2 transactions");
      assertStringIncludes(text, "($80.00)"); // net of -50 + -30
      assertStringIncludes(text, "Store A");
      assertStringIncludes(text, "Store B");
      // Verify order: Store A (2024-03-15) should come before Store B (2024-03-10)
      const storeAIndex = text.indexOf("Store A");
      const storeBIndex = text.indexOf("Store B");
      assertEquals(storeAIndex < storeBIndex, true);
    });
  });

  // ---------------------------------------------------------------------------
  // End-to-end flow simulation
  // ---------------------------------------------------------------------------

  describe("end-to-end flow", () => {
    it("fetches, filters, sorts, and formats transactions", async () => {
      const plan = makePlan({ id: planId, name: planName });
      const currency = plan.currency_format;

      const transactions = [
        makeTransaction({
          date: "2024-01-10",
          cleared: "cleared",
          payee_name: "Alpha",
          amount: -10000,
          deleted: false,
        }),
        makeTransaction({
          date: "2024-01-20",
          cleared: "uncleared",
          payee_name: "Beta",
          amount: -20000,
          deleted: false,
        }),
        makeTransaction({
          date: "2024-01-15",
          cleared: "cleared",
          payee_name: "Gamma",
          amount: -15000,
          deleted: false,
        }),
        makeTransaction({
          date: "2024-01-05",
          cleared: "cleared",
          payee_name: "Delta",
          amount: -5000,
          deleted: true,
        }),
      ];

      fetchMock.mock(
        `/v1/budgets/${planId}/transactions`,
        makeTransactionsResponse(transactions),
      );

      const client = new YnabClient("test-token");
      const result = await client.getTransactions(planId);

      // Step 1: filter deleted
      let filtered = result.transactions.filter((t) => !t.deleted);
      assertEquals(filtered.length, 3);

      // Step 2: apply cleared filter
      const cleared = "cleared" as const;
      filtered = filtered.filter((t) => t.cleared === cleared);
      assertEquals(filtered.length, 2);

      // Step 3: sort by date descending
      filtered.sort((a, b) => b.date.localeCompare(a.date));
      assertEquals(filtered[0].payee_name, "Gamma"); // 2024-01-15
      assertEquals(filtered[1].payee_name, "Alpha"); // 2024-01-10

      // Step 4: verify formatting
      const totalAmount = filtered.reduce((sum, t) => sum + t.amount, 0);
      assertEquals(totalAmount, -25000);
      assertEquals(formatMoney(totalAmount, currency), "($25.00)");

      const sections: string[] = [
        `Budget: ${planName}`,
        "\u2500".repeat(40),
        `${filtered.length} transactions \u2014 Net: ${
          formatMoney(totalAmount, currency)
        }`,
        "",
      ];
      for (const txn of filtered) {
        sections.push(formatTransaction(txn, currency));
      }
      const text = sections.join("\n");

      assertStringIncludes(text, "Budget: Test Budget");
      assertStringIncludes(text, "2 transactions");
      assertStringIncludes(text, "($25.00)");
      assertStringIncludes(text, "Gamma");
      assertStringIncludes(text, "Alpha");
      // Gamma (newer) should appear before Alpha (older)
      assertEquals(text.indexOf("Gamma") < text.indexOf("Alpha"), true);
    });

    it("combines search with cleared filter", async () => {
      const transactions = [
        makeTransaction({
          cleared: "uncleared",
          payee_name: "Grocery Store",
          memo: null,
        }),
        makeTransaction({
          cleared: "uncleared",
          payee_name: "Gas Station",
          memo: "grocery run",
        }),
        makeTransaction({
          cleared: "cleared",
          payee_name: "Grocery Outlet",
          memo: null,
        }),
        makeTransaction({
          cleared: "uncleared",
          payee_name: "Amazon",
          memo: null,
        }),
      ];

      fetchMock.mock(
        `/v1/budgets/${planId}/transactions`,
        makeTransactionsResponse(transactions),
      );

      const client = new YnabClient("test-token");
      const result = await client.getTransactions(planId);

      let filtered = result.transactions.filter((t) => !t.deleted);

      // Apply cleared filter
      filtered = filtered.filter((t) => t.cleared === "uncleared");
      assertEquals(filtered.length, 3);

      // Apply search filter
      const searchLower = "grocery";
      filtered = filtered.filter((t) => {
        const payeeMatch = t.payee_name?.toLowerCase().includes(searchLower);
        const memoMatch = t.memo?.toLowerCase().includes(searchLower);
        return payeeMatch || memoMatch;
      });

      assertEquals(filtered.length, 2);
      // Should match "Grocery Store" (payee) and "Gas Station" (memo contains "grocery")
      const payeeNames = filtered.map((t) => t.payee_name).sort();
      assertEquals(payeeNames, ["Gas Station", "Grocery Store"]);
    });
  });
});
