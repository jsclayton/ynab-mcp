import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerCategorizePrompt(server: McpServer): void {
  server.prompt(
    "categorize_transactions",
    "Review and categorize uncategorized transactions",
    {
      plan_id: z.string().describe("Budget plan ID"),
    },
    ({ plan_id }) => {
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Help me categorize my uncategorized transactions.

Budget Plan ID: ${plan_id}

Please follow these steps:

1. First, use get_budget with plan_id="${plan_id}" and view="overview" to understand my category structure.

2. Use get_transactions with plan_id="${plan_id}" and type="uncategorized" to fetch all uncategorized transactions.

3. If there are no uncategorized transactions, let me know and we're done!

4. For each uncategorized transaction, suggest a category based on:
   - The payee name (match against common payee patterns)
   - The transaction amount (helps distinguish e.g., a small coffee shop purchase vs a large grocery run)
   - Similar past transactions (look for the same payee in categorized transactions)

5. Present the suggestions in a table format:
   | Date | Payee | Amount | Suggested Category | Confidence |

   Where confidence is High/Medium/Low based on how certain you are.

6. Ask me to:
   - Approve all suggestions
   - Approve with modifications (I'll tell you which ones to change)
   - Go through them one by one

7. After I approve, use modify_transactions with action "update" to batch-update all the transactions with their categories.

8. Summarize: how many transactions categorized, by category breakdown.

Let's start!`,
            },
          },
        ],
      };
    },
  );
}
