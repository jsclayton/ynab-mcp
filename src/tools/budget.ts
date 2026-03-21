import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { YnabClient } from "../ynab/client.ts";
import type { Cache } from "../ynab/cache.ts";
import {
  formatAccount,
  formatCategory,
  formatMoney,
  formatMonthSummary,
  formatScheduledTransaction,
} from "../ynab/format.ts";

export function registerBudgetTools(
  server: McpServer,
  client: YnabClient,
  cache: Cache,
): void {
  server.tool(
    "get_budget",
    `Get budget data for a plan. Views:
- overview: accounts + category groups + current month (start here)
- month: full budget for a specific month with all categories
- category: single category deep-dive with goal progress
- scheduled: upcoming recurring/scheduled transactions
- money_movements: how money was budgeted across categories for a month`,
    {
      plan_id: z.string().describe("Budget plan ID (from list_plans)"),
      view: z
        .enum([
          "overview",
          "month",
          "category",
          "scheduled",
          "money_movements",
        ])
        .describe("Which budget view to return"),
      month: z
        .string()
        .optional()
        .describe(
          "Month in YYYY-MM-DD format (required for month, category, and money_movements views). Use first of month, e.g. '2024-01-01'.",
        ),
      category_id: z
        .string()
        .optional()
        .describe("Category ID (required for category view)"),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ plan_id, view, month, category_id }) => {
      const currency = await cache.getCurrencyFormat(plan_id);

      // Get the plan name for the header
      const planData = await client.getPlans();
      const planName = planData.budgets.find((b) => b.id === plan_id)?.name ??
        plan_id;
      const header = `Budget: ${planName}\n${"─".repeat(40)}`;

      switch (view) {
        case "overview": {
          const [accounts, groups, months] = await Promise.all([
            cache.getAccounts(plan_id),
            cache.getCategoryGroups(plan_id),
            client.getMonths(plan_id),
          ]);

          const currentMonth = months.months?.[0];

          const sections: string[] = [header];

          // Accounts section
          const onBudget = accounts.filter(
            (a) => !a.deleted && !a.closed && a.on_budget,
          );
          const offBudget = accounts.filter(
            (a) => !a.deleted && !a.closed && !a.on_budget,
          );

          if (onBudget.length > 0) {
            sections.push("\n## On-Budget Accounts");
            for (const a of onBudget) {
              sections.push(formatAccount(a, currency));
            }
          }

          if (offBudget.length > 0) {
            sections.push("\n## Off-Budget Accounts");
            for (const a of offBudget) {
              sections.push(formatAccount(a, currency));
            }
          }

          // Month summary
          if (currentMonth) {
            sections.push("\n## Current Month");
            sections.push(formatMonthSummary(currentMonth, currency));
          }

          // Category groups summary
          sections.push("\n## Category Groups");
          for (const group of groups) {
            if (group.deleted || group.hidden) continue;
            const activeCats = group.categories.filter(
              (c) => !c.deleted && !c.hidden,
            );
            const totalBalance = activeCats.reduce(
              (sum, c) => sum + c.balance,
              0,
            );
            sections.push(
              `${group.name} — ${activeCats.length} categories — Available: ${
                formatMoney(totalBalance, currency)
              }`,
            );
          }

          return { content: [{ type: "text", text: sections.join("\n") }] };
        }

        case "month": {
          if (!month) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    "Error: 'month' parameter is required for the month view (format: YYYY-MM-DD, e.g. '2024-01-01')",
                },
              ],
            };
          }

          const monthData = await client.getMonth(plan_id, month);
          const m = monthData.month;

          const sections: string[] = [header, formatMonthSummary(m, currency)];

          // Group categories by category_group_name
          const byGroup = new Map<string, typeof m.categories>();
          for (const cat of m.categories) {
            if (cat.deleted || cat.hidden) continue;
            const groupName = cat.category_group_name ?? "Other";
            if (!byGroup.has(groupName)) byGroup.set(groupName, []);
            byGroup.get(groupName)!.push(cat);
          }

          for (const [groupName, cats] of byGroup) {
            sections.push(`\n## ${groupName}`);
            for (const cat of cats) {
              sections.push(formatCategory(cat, currency));
            }
          }

          return { content: [{ type: "text", text: sections.join("\n") }] };
        }

        case "category": {
          if (!category_id) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    "Error: 'category_id' parameter is required for the category view",
                },
              ],
            };
          }
          if (!month) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    "Error: 'month' parameter is required for the category view (format: YYYY-MM-DD)",
                },
              ],
            };
          }

          const monthData = await client.getMonth(plan_id, month);
          const cat = monthData.month.categories.find(
            (c) => c.id === category_id,
          );

          if (!cat) {
            return {
              content: [
                {
                  type: "text",
                  text: `Category ${category_id} not found in month ${month}`,
                },
              ],
            };
          }

          const sections: string[] = [header];
          sections.push(`\n## ${cat.name} — ${month}`);
          sections.push(formatCategory(cat, currency));

          // Goal details
          if (cat.goal_type) {
            sections.push("\n### Goal Details");
            sections.push(`Type: ${cat.goal_type}`);
            if (cat.goal_target !== null) {
              sections.push(
                `Target: ${formatMoney(cat.goal_target, currency)}`,
              );
            }
            if (cat.goal_target_month) {
              sections.push(`Target Month: ${cat.goal_target_month}`);
            }
            if (cat.goal_percentage_complete !== null) {
              sections.push(`Progress: ${cat.goal_percentage_complete}%`);
            }
            if (cat.goal_months_to_budget !== null) {
              sections.push(`Months to Budget: ${cat.goal_months_to_budget}`);
            }
            if (cat.goal_under_funded !== null) {
              sections.push(
                `Underfunded: ${formatMoney(cat.goal_under_funded, currency)}`,
              );
            }
            if (cat.goal_overall_funded !== null) {
              sections.push(
                `Overall Funded: ${
                  formatMoney(cat.goal_overall_funded, currency)
                }`,
              );
            }
            if (cat.goal_overall_left !== null) {
              sections.push(
                `Overall Left: ${formatMoney(cat.goal_overall_left, currency)}`,
              );
            }
            if (cat.goal_day !== null) {
              sections.push(`Goal Day: ${cat.goal_day}`);
            }
            if (cat.goal_cadence !== null) {
              sections.push(`Cadence: ${cat.goal_cadence}`);
            }
            if (cat.goal_cadence_frequency !== null) {
              sections.push(
                `Cadence Frequency: ${cat.goal_cadence_frequency}`,
              );
            }
            if (cat.goal_creation_month) {
              sections.push(`Created: ${cat.goal_creation_month}`);
            }
          }

          if (cat.note) sections.push(`\nNote: ${cat.note}`);

          return { content: [{ type: "text", text: sections.join("\n") }] };
        }

        case "scheduled": {
          const data = await client.getScheduledTransactions(plan_id);
          const txns = data.scheduled_transactions.filter((st) => !st.deleted);

          const sections: string[] = [
            header,
            `\n## Scheduled Transactions (${txns.length})`,
          ];

          if (txns.length === 0) {
            sections.push("No scheduled transactions.");
          } else {
            for (const st of txns) {
              sections.push(formatScheduledTransaction(st, currency));
            }
          }

          return { content: [{ type: "text", text: sections.join("\n") }] };
        }

        case "money_movements": {
          if (!month) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    "Error: 'month' parameter is required for the money_movements view (format: YYYY-MM-DD)",
                },
              ],
            };
          }

          const monthData = await client.getMonth(plan_id, month);
          const m = monthData.month;

          const sections: string[] = [
            header,
            `\n## Money Movements — ${month}`,
          ];
          sections.push(formatMonthSummary(m, currency));

          // Show categories with non-zero budgeted amounts
          const withBudget = m.categories
            .filter((c) => !c.deleted && !c.hidden && c.budgeted !== 0)
            .sort((a, b) => b.budgeted - a.budgeted);

          if (withBudget.length === 0) {
            sections.push("\nNo budget allocations for this month.");
          } else {
            sections.push("\n### Budget Allocations");
            const positive = withBudget.filter((c) => c.budgeted > 0);
            const negative = withBudget.filter((c) => c.budgeted < 0);

            if (positive.length > 0) {
              sections.push("\nFunded:");
              for (const c of positive) {
                sections.push(
                  `  ${c.name}: +${formatMoney(c.budgeted, currency)}`,
                );
              }
            }

            if (negative.length > 0) {
              sections.push("\nReduced:");
              for (const c of negative) {
                sections.push(
                  `  ${c.name}: ${formatMoney(c.budgeted, currency)}`,
                );
              }
            }
          }

          return { content: [{ type: "text", text: sections.join("\n") }] };
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown view: ${view}` }],
          };
      }
    },
  );
}
