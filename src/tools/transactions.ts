import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { YnabClient } from "../ynab/client.ts";
import type { Cache } from "../ynab/cache.ts";
import { formatMoney, formatTransaction } from "../ynab/format.ts";
import type { Transaction } from "../ynab/types.ts";

export function registerTransactionTools(
  server: McpServer,
  client: YnabClient,
  cache: Cache,
): void {
  server.tool(
    "get_transactions",
    `Search and filter transactions. Routes to the most specific YNAB endpoint based on filters provided.
For reconciliation: use cleared="uncleared" with account_id.
Results are sorted by date (newest first) and truncated to limit.`,
    {
      plan_id: z.string().describe("Budget plan ID"),
      account_id: z.string().optional().describe("Filter by account ID"),
      category_id: z.string().optional().describe("Filter by category ID"),
      payee_id: z.string().optional().describe("Filter by payee ID"),
      since_date: z.string().optional().describe(
        "Only transactions on or after this date (YYYY-MM-DD)",
      ),
      cleared: z.enum(["cleared", "uncleared", "reconciled"]).optional()
        .describe("Filter by cleared status"),
      type: z.enum(["uncategorized", "unapproved"]).optional()
        .describe("Filter for uncategorized or unapproved transactions"),
      search: z.string().optional()
        .describe(
          "Client-side search — filters by payee name or memo (case-insensitive)",
        ),
      limit: z.number().optional().default(50)
        .describe("Maximum transactions to return (default 50, max 200)"),
    },
    { readOnlyHint: true, openWorldHint: true },
    async (
      {
        plan_id,
        account_id,
        category_id,
        payee_id,
        since_date,
        cleared,
        type,
        search,
        limit,
      },
    ) => {
      const currency = await cache.getCurrencyFormat(plan_id);

      // Get plan name for header
      const planData = await client.getPlans();
      const planName =
        planData.budgets.find((b: { id: string; name: string }) =>
          b.id === plan_id
        )?.name ?? plan_id;

      // Build API params
      const params: {
        since_date?: string;
        type?: "uncategorized" | "unapproved";
      } = {};
      if (since_date) params.since_date = since_date;
      if (type) params.type = type;

      // Route to most specific endpoint
      let result: { transactions: Transaction[] };
      if (account_id) {
        result = await client.getTransactionsByAccount(
          plan_id,
          account_id,
          params,
        );
      } else if (category_id) {
        result = await client.getTransactionsByCategory(
          plan_id,
          category_id,
          params,
        );
      } else if (payee_id) {
        result = await client.getTransactionsByPayee(plan_id, payee_id, params);
      } else {
        result = await client.getTransactions(plan_id, params);
      }

      let transactions = result.transactions.filter((t: Transaction) =>
        !t.deleted
      );

      // Client-side filters
      if (cleared) {
        transactions = transactions.filter((t: Transaction) =>
          t.cleared === cleared
        );
      }

      if (search) {
        const searchLower = search.toLowerCase();
        transactions = transactions.filter((t: Transaction) => {
          const payeeMatch = t.payee_name?.toLowerCase().includes(searchLower);
          const memoMatch = t.memo?.toLowerCase().includes(searchLower);
          return payeeMatch || memoMatch;
        });
      }

      // Sort by date descending (newest first)
      transactions.sort((a: Transaction, b: Transaction) =>
        b.date.localeCompare(a.date)
      );

      // Apply limit (cap at 200)
      const effectiveLimit = Math.min(limit ?? 50, 200);
      const total = transactions.length;
      const truncated = total > effectiveLimit;
      transactions = transactions.slice(0, effectiveLimit);

      // Format output
      const header = `Budget: ${planName}`;
      const sections: string[] = [header, "\u2500".repeat(40)];

      if (transactions.length === 0) {
        sections.push("No transactions found matching your filters.");
      } else {
        // Summary line
        const totalAmount = transactions.reduce(
          (sum: number, t: Transaction) => sum + t.amount,
          0,
        );
        sections.push(
          `${transactions.length}${
            truncated ? ` of ${total}` : ""
          } transactions \u2014 Net: ${formatMoney(totalAmount, currency)}`,
        );
        sections.push("");

        for (const txn of transactions) {
          sections.push(formatTransaction(txn, currency));
        }

        if (truncated) {
          sections.push(
            `\n... and ${
              total - effectiveLimit
            } more. Use since_date or other filters to narrow results.`,
          );
        }
      }

      return { content: [{ type: "text", text: sections.join("\n") }] };
    },
  );
}
