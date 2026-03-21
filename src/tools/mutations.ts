import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { YnabClient } from "../ynab/client.ts";
import type { Cache } from "../ynab/cache.ts";
import { dollarsToMilliunits, formatMoney } from "../ynab/format.ts";

const TransactionInput = z.object({
  date: z.string().describe("Transaction date (YYYY-MM-DD)"),
  amount: z
    .number()
    .describe("Amount in dollars (negative for outflow, positive for inflow)"),
  account_id: z.string().describe("Account ID"),
  payee_name: z
    .string()
    .optional()
    .describe("Payee name (creates new payee if needed)"),
  payee_id: z.string().optional().describe("Existing payee ID"),
  category_id: z.string().optional().describe("Category ID"),
  memo: z.string().optional().describe("Transaction memo"),
  cleared: z
    .enum(["cleared", "uncleared", "reconciled"])
    .optional()
    .describe("Cleared status"),
  approved: z
    .boolean()
    .optional()
    .describe("Whether transaction is approved"),
});

const TransactionUpdate = z.object({
  id: z.string().describe("Transaction ID to update"),
  date: z.string().optional(),
  amount: z.number().optional().describe("New amount in dollars"),
  payee_name: z.string().optional(),
  payee_id: z.string().optional(),
  category_id: z.string().optional(),
  memo: z.string().optional(),
  cleared: z
    .enum(["cleared", "uncleared", "reconciled"])
    .optional(),
  approved: z.boolean().optional(),
  flag_color: z
    .enum(["red", "orange", "yellow", "green", "blue", "purple"])
    .nullable()
    .optional(),
});

async function getPlanName(
  client: YnabClient,
  planId: string,
): Promise<string> {
  const planData = await client.getPlans();
  return planData.budgets.find((b) => b.id === planId)?.name ?? planId;
}

export function registerMutationTools(
  server: McpServer,
  client: YnabClient,
  cache: Cache,
): void {
  // ---------------------------------------------------------------------------
  // Tool 1: modify_transactions
  // ---------------------------------------------------------------------------

  server.tool(
    "modify_transactions",
    `Create, update, delete, or import transactions. Dollar amounts are auto-converted to YNAB milliunits.
- create: Add new transactions (batch supported)
- update: Modify existing transactions (batch supported) — use for clearing, categorizing, editing
- delete: Permanently remove a transaction
- import: Trigger sync from linked bank accounts`,
    {
      plan_id: z.string().describe("Budget plan ID"),
      action: z
        .enum(["create", "update", "delete", "import"])
        .describe("What to do"),
      transactions: z
        .array(TransactionInput)
        .optional()
        .describe(
          "Transactions to create — pass ALL transactions in a single call rather than one at a time (required for 'create' action)",
        ),
      updates: z
        .array(TransactionUpdate)
        .optional()
        .describe(
          "Transaction updates — pass ALL updates in a single call rather than one at a time (required for 'update' action)",
        ),
      transaction_id: z
        .string()
        .optional()
        .describe("Transaction ID to delete (required for 'delete' action)"),
    },
    { destructiveHint: true, openWorldHint: true },
    async ({ plan_id, action, transactions, updates, transaction_id }) => {
      const planName = await getPlanName(client, plan_id);
      const currency = await cache.getCurrencyFormat(plan_id);
      const header = `Budget: ${planName}\n${"─".repeat(40)}`;

      switch (action) {
        case "create": {
          if (!transactions || transactions.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${header}\nError: 'transactions' array is required for the create action.`,
                },
              ],
            };
          }

          const apiTransactions = transactions.map((t) => ({
            date: t.date,
            amount: dollarsToMilliunits(t.amount),
            account_id: t.account_id,
            payee_name: t.payee_name,
            payee_id: t.payee_id,
            category_id: t.category_id,
            memo: t.memo,
            cleared: t.cleared,
            approved: t.approved,
          }));

          const result = await client.createTransactions(
            plan_id,
            apiTransactions,
          );
          cache.invalidate(plan_id);

          const created = result.transactions ?? [];
          const duplicates = result.duplicate_import_ids ?? [];

          const lines: string[] = [header];
          lines.push(
            `\nCreated ${created.length} transaction${
              created.length !== 1 ? "s" : ""
            }.`,
          );

          for (const txn of created) {
            const amount = formatMoney(txn.amount, currency);
            const payee = txn.payee_name ?? "—";
            lines.push(`  ${txn.date}  ${amount}  ${payee}`);
          }

          if (duplicates.length > 0) {
            lines.push(
              `\n${duplicates.length} duplicate import ID${
                duplicates.length !== 1 ? "s" : ""
              } skipped.`,
            );
          }

          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
          };
        }

        case "update": {
          if (!updates || updates.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${header}\nError: 'updates' array is required for the update action.`,
                },
              ],
            };
          }

          const apiUpdates = updates.map((u) => {
            const entry: Record<string, unknown> = { id: u.id };
            if (u.date !== undefined) entry.date = u.date;
            if (u.amount !== undefined) {
              entry.amount = dollarsToMilliunits(u.amount);
            }
            if (u.payee_name !== undefined) entry.payee_name = u.payee_name;
            if (u.payee_id !== undefined) entry.payee_id = u.payee_id;
            if (u.category_id !== undefined) entry.category_id = u.category_id;
            if (u.memo !== undefined) entry.memo = u.memo;
            if (u.cleared !== undefined) entry.cleared = u.cleared;
            if (u.approved !== undefined) entry.approved = u.approved;
            if (u.flag_color !== undefined) entry.flag_color = u.flag_color;
            return entry;
          });

          const result = await client.updateTransactions(plan_id, apiUpdates);
          cache.invalidate(plan_id);

          const updated = result.transactions ?? [];
          const lines: string[] = [header];
          lines.push(
            `\nUpdated ${updated.length} transaction${
              updated.length !== 1 ? "s" : ""
            }.`,
          );

          for (const txn of updated) {
            const amount = formatMoney(txn.amount, currency);
            const payee = txn.payee_name ?? "—";
            lines.push(`  ${txn.date}  ${amount}  ${payee}`);
          }

          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
          };
        }

        case "delete": {
          if (!transaction_id) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${header}\nError: 'transaction_id' is required for the delete action.`,
                },
              ],
            };
          }

          const result = await client.deleteTransaction(
            plan_id,
            transaction_id,
          );
          cache.invalidate(plan_id);

          const txn = result.transaction;
          const amount = formatMoney(txn.amount, currency);
          const payee = txn.payee_name ?? "—";

          return {
            content: [
              {
                type: "text" as const,
                text:
                  `${header}\nDeleted transaction: ${txn.date}  ${amount}  ${payee}`,
              },
            ],
          };
        }

        case "import": {
          const result = await client.importTransactions(plan_id);
          cache.invalidate(plan_id);

          const count = result.transaction_ids?.length ?? 0;

          return {
            content: [
              {
                type: "text" as const,
                text: `${header}\nImported ${count} transaction${
                  count !== 1 ? "s" : ""
                } from linked accounts.`,
              },
            ],
          };
        }

        default:
          return {
            content: [
              {
                type: "text" as const,
                text: `${header}\nUnknown action: ${action}`,
              },
            ],
          };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Tool 2: modify_budget
  // ---------------------------------------------------------------------------

  server.tool(
    "modify_budget",
    `Modify budget allocations and category structure.
- set_amount: Change budgeted amount for a category in a month
- update_category: Rename or hide/unhide a category
- set_goal: Update a category's goal target amount and/or target date
Note: Creating categories/groups requires the YNAB app.`,
    {
      plan_id: z.string().describe("Budget plan ID"),
      action: z
        .enum(["set_amount", "update_category", "set_goal"])
        .describe("What to do"),
      month: z
        .string()
        .optional()
        .describe("Month (YYYY-MM-DD) for set_amount and set_goal"),
      category_id: z.string().optional().describe("Category ID"),
      amount: z
        .number()
        .optional()
        .describe("Budget amount in dollars (for set_amount)"),
      name: z
        .string()
        .optional()
        .describe("New name (for update_category)"),
      hidden: z
        .boolean()
        .optional()
        .describe("Hidden status (for update_category)"),
      goal_target: z
        .number()
        .optional()
        .describe("Goal target amount in dollars (for set_goal)"),
      goal_target_date: z
        .string()
        .optional()
        .describe("Goal target date YYYY-MM-DD (for set_goal)"),
    },
    { destructiveHint: true, openWorldHint: true },
    async ({
      plan_id,
      action,
      month,
      category_id,
      amount,
      name,
      hidden,
      goal_target,
      goal_target_date,
    }) => {
      const planName = await getPlanName(client, plan_id);
      const currency = await cache.getCurrencyFormat(plan_id);
      const header = `Budget: ${planName}\n${"─".repeat(40)}`;

      switch (action) {
        case "set_amount": {
          if (!month) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${header}\nError: 'month' is required for set_amount (format: YYYY-MM-DD).`,
                },
              ],
            };
          }
          if (!category_id) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${header}\nError: 'category_id' is required for set_amount.`,
                },
              ],
            };
          }
          if (amount === undefined) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${header}\nError: 'amount' is required for set_amount.`,
                },
              ],
            };
          }

          const milliunits = dollarsToMilliunits(amount);
          const result = await client.updateMonthCategory(
            plan_id,
            month,
            category_id,
            { budgeted: milliunits },
          );
          cache.invalidate(plan_id);

          const cat = result.category;
          const budgeted = formatMoney(cat.budgeted, currency);
          const available = formatMoney(cat.balance, currency);

          return {
            content: [
              {
                type: "text" as const,
                text:
                  `${header}\nSet ${cat.name} budget for ${month} to ${budgeted}.\nAvailable: ${available}`,
              },
            ],
          };
        }

        case "update_category": {
          if (!category_id) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${header}\nError: 'category_id' is required for update_category.`,
                },
              ],
            };
          }
          if (name === undefined && hidden === undefined) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${header}\nError: At least one of 'name' or 'hidden' is required for update_category.`,
                },
              ],
            };
          }

          const data: Record<string, unknown> = {};
          if (name !== undefined) data.name = name;
          if (hidden !== undefined) data.hidden = hidden;

          const result = await client.updateCategory(
            plan_id,
            category_id,
            data,
          );
          cache.invalidate(plan_id);

          const cat = result.category;
          const parts: string[] = [`Updated category: ${cat.name}`];
          if (hidden !== undefined) {
            parts.push(cat.hidden ? "(now hidden)" : "(now visible)");
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `${header}\n${parts.join(" ")}`,
              },
            ],
          };
        }

        case "set_goal": {
          if (!category_id) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${header}\nError: 'category_id' is required for set_goal.`,
                },
              ],
            };
          }
          if (!month) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${header}\nError: 'month' is required for set_goal (format: YYYY-MM-DD).`,
                },
              ],
            };
          }
          if (goal_target === undefined && goal_target_date === undefined) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${header}\nError: At least one of 'goal_target' or 'goal_target_date' is required for set_goal.`,
                },
              ],
            };
          }

          const data: Record<string, unknown> = {};
          if (goal_target !== undefined) {
            data.goal_target = dollarsToMilliunits(goal_target);
          }
          if (goal_target_date !== undefined) {
            data.goal_target_month = goal_target_date;
          }

          const result = await client.updateMonthCategory(
            plan_id,
            month,
            category_id,
            data as { budgeted: number },
          );
          cache.invalidate(plan_id);

          const cat = result.category;
          const parts: string[] = [`Updated goal for ${cat.name}`];
          if (goal_target !== undefined) {
            parts.push(
              `Target: ${
                formatMoney(dollarsToMilliunits(goal_target), currency)
              }`,
            );
          }
          if (goal_target_date !== undefined) {
            parts.push(`Target date: ${goal_target_date}`);
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `${header}\n${parts.join("  ")}`,
              },
            ],
          };
        }

        default:
          return {
            content: [
              {
                type: "text" as const,
                text: `${header}\nUnknown action: ${action}`,
              },
            ],
          };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Tool 3: modify_scheduled_transactions
  // ---------------------------------------------------------------------------

  server.tool(
    "modify_scheduled_transactions",
    `Create, update, or delete scheduled/recurring transactions.
- create: Set up a new recurring transaction
- update: Modify an existing scheduled transaction
- delete: Remove a scheduled transaction`,
    {
      plan_id: z.string().describe("Budget plan ID"),
      action: z
        .enum(["create", "update", "delete"])
        .describe("What to do"),
      scheduled_transaction_id: z
        .string()
        .optional()
        .describe("ID for update/delete"),
      date_first: z
        .string()
        .optional()
        .describe("First occurrence date YYYY-MM-DD (create)"),
      frequency: z
        .enum([
          "never",
          "daily",
          "weekly",
          "everyOtherWeek",
          "twiceAMonth",
          "every4Weeks",
          "monthly",
          "everyOtherMonth",
          "every3Months",
          "every4Months",
          "twiceAYear",
          "yearly",
          "everyOtherYear",
        ])
        .optional(),
      amount: z.number().optional().describe("Amount in dollars"),
      account_id: z.string().optional().describe("Account ID"),
      payee_id: z.string().optional().describe("Existing payee ID"),
      payee_name: z.string().optional().describe("Payee name"),
      category_id: z.string().optional().describe("Category ID"),
      memo: z.string().optional().describe("Memo"),
    },
    { destructiveHint: true, openWorldHint: true },
    async ({
      plan_id,
      action,
      scheduled_transaction_id,
      date_first,
      frequency,
      amount,
      account_id,
      payee_id,
      payee_name,
      category_id,
      memo,
    }) => {
      const planName = await getPlanName(client, plan_id);
      const currency = await cache.getCurrencyFormat(plan_id);
      const header = `Budget: ${planName}\n${"─".repeat(40)}`;

      switch (action) {
        case "create": {
          if (!date_first) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${header}\nError: 'date_first' is required for creating a scheduled transaction.`,
                },
              ],
            };
          }
          if (!frequency) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${header}\nError: 'frequency' is required for creating a scheduled transaction.`,
                },
              ],
            };
          }
          if (amount === undefined) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${header}\nError: 'amount' is required for creating a scheduled transaction.`,
                },
              ],
            };
          }
          if (!account_id) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${header}\nError: 'account_id' is required for creating a scheduled transaction.`,
                },
              ],
            };
          }

          const data: Record<string, unknown> = {
            date_first,
            frequency,
            amount: dollarsToMilliunits(amount),
            account_id,
          };
          if (payee_id !== undefined) data.payee_id = payee_id;
          if (payee_name !== undefined) data.payee_name = payee_name;
          if (category_id !== undefined) data.category_id = category_id;
          if (memo !== undefined) data.memo = memo;

          const result = await client.createScheduledTransaction(
            plan_id,
            data,
          );
          cache.invalidate(plan_id);

          const st = result.scheduled_transaction;
          const fmtAmount = formatMoney(st.amount, currency);
          const payee = st.payee_name ?? "—";

          return {
            content: [
              {
                type: "text" as const,
                text:
                  `${header}\nCreated scheduled transaction: ${fmtAmount}  ${payee}  ${st.frequency}\nFirst date: ${st.date_first}  Next: ${st.date_next}`,
              },
            ],
          };
        }

        case "update": {
          if (!scheduled_transaction_id) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${header}\nError: 'scheduled_transaction_id' is required for the update action.`,
                },
              ],
            };
          }

          const data: Record<string, unknown> = {};
          if (date_first !== undefined) data.date_first = date_first;
          if (frequency !== undefined) data.frequency = frequency;
          if (amount !== undefined) {
            data.amount = dollarsToMilliunits(amount);
          }
          if (account_id !== undefined) data.account_id = account_id;
          if (payee_id !== undefined) data.payee_id = payee_id;
          if (payee_name !== undefined) data.payee_name = payee_name;
          if (category_id !== undefined) data.category_id = category_id;
          if (memo !== undefined) data.memo = memo;

          const result = await client.updateScheduledTransaction(
            plan_id,
            scheduled_transaction_id,
            data,
          );
          cache.invalidate(plan_id);

          const st = result.scheduled_transaction;
          const fmtAmount = formatMoney(st.amount, currency);
          const payee = st.payee_name ?? "—";

          return {
            content: [
              {
                type: "text" as const,
                text:
                  `${header}\nUpdated scheduled transaction: ${fmtAmount}  ${payee}  ${st.frequency}\nNext: ${st.date_next}`,
              },
            ],
          };
        }

        case "delete": {
          if (!scheduled_transaction_id) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${header}\nError: 'scheduled_transaction_id' is required for the delete action.`,
                },
              ],
            };
          }

          const result = await client.deleteScheduledTransaction(
            plan_id,
            scheduled_transaction_id,
          );
          cache.invalidate(plan_id);

          const st = result.scheduled_transaction;
          const fmtAmount = formatMoney(st.amount, currency);
          const payee = st.payee_name ?? "—";

          return {
            content: [
              {
                type: "text" as const,
                text:
                  `${header}\nDeleted scheduled transaction: ${fmtAmount}  ${payee}`,
              },
            ],
          };
        }

        default:
          return {
            content: [
              {
                type: "text" as const,
                text: `${header}\nUnknown action: ${action}`,
              },
            ],
          };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Tool 4: update_payee
  // ---------------------------------------------------------------------------

  server.tool(
    "update_payee",
    "Rename a payee for cleaner transaction history.",
    {
      plan_id: z.string().describe("Budget plan ID"),
      payee_id: z.string().describe("Payee ID to update"),
      name: z.string().describe("New payee name"),
    },
    { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async ({ plan_id, payee_id, name }) => {
      const planName = await getPlanName(client, plan_id);
      const header = `Budget: ${planName}\n${"─".repeat(40)}`;

      const result = await client.updatePayee(plan_id, payee_id, { name });
      cache.invalidate(plan_id);

      const payee = result.payee;

      return {
        content: [
          {
            type: "text" as const,
            text: `${header}\nRenamed payee to: ${payee.name}`,
          },
        ],
      };
    },
  );
}
