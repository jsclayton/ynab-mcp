import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerSpendingAnalysisPrompt(server: McpServer): void {
  server.prompt(
    "spending_analysis",
    "Analyze spending patterns and budget health for a given period",
    {
      plan_id: z.string().describe("Budget plan ID"),
      period: z.string().describe(
        "Time period to analyze (e.g. '2024-01' for a month, '2024-Q1' for a quarter, '2024' for a year, or 'last-3-months')",
      ),
    },
    ({ plan_id, period }) => {
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Analyze my spending for the period: ${period}

Budget Plan ID: ${plan_id}

Please follow these steps:

1. Start with get_budget using plan_id="${plan_id}" and view="overview" to understand my budget structure and current state.

2. Parse the period "${period}" to determine the date range:
   - "YYYY-MM" → that specific month
   - "YYYY-QN" → that quarter (Q1=Jan-Mar, Q2=Apr-Jun, etc.)
   - "YYYY" → full year
   - "last-N-months" → the last N complete months from today

3. For each month in the period, use get_budget with view="month" to get category-level spending data.

4. Use get_transactions with plan_id="${plan_id}" and since_date set to the start of the period to get transaction-level detail.

5. Provide a comprehensive analysis:

   **Summary**
   - Total income vs total spending for the period
   - Net savings rate

   **Category Breakdown**
   - Top spending categories (sorted by amount)
   - Categories that went over budget (with amount over)
   - Categories with significant unused budget

   **Trends** (if multi-month period)
   - Month-over-month spending changes
   - Categories trending up or down

   **Top Payees**
   - Highest spend payees
   - Frequency of transactions per payee

   **Budget Health**
   - Age of money (if available)
   - Categories with goals that are underfunded
   - Recommendations for budget adjustments

Please present the analysis in a clear, organized format with dollar amounts.`,
            },
          },
        ],
      };
    },
  );
}
