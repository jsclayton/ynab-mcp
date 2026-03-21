import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerReconciliationPrompt(server: McpServer): void {
  server.prompt(
    "reconcile_account",
    "Guide the user through reconciling a bank account against their YNAB records",
    {
      plan_id: z.string().describe("Budget plan ID"),
      account_id: z.string().describe("Account ID to reconcile"),
      bank_balance: z.string().describe(
        "Current balance shown by the bank (in dollars, e.g. '1234.56')",
      ),
    },
    ({ plan_id, account_id, bank_balance }) => {
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Help me reconcile my account. Here are the details:

- Budget Plan ID: ${plan_id}
- Account ID: ${account_id}
- Bank Balance: $${bank_balance}

Please follow these steps:

1. First, use get_transactions with plan_id="${plan_id}", account_id="${account_id}", and cleared="uncleared" to fetch all uncleared transactions.

2. Show me the list of uncleared transactions and ask me to confirm each one:
   - For each transaction, ask: "Did this transaction clear? [date] [payee] [amount]"
   - Keep a running tally of confirmed transactions

3. After reviewing all transactions, calculate:
   - YNAB cleared balance + confirmed uncleared transactions = expected balance
   - Compare to bank balance of $${bank_balance}

4. If there's a discrepancy:
   - Show the difference
   - Ask if I want to create an adjustment transaction
   - If yes, use modify_transactions to create an adjustment

5. For all confirmed transactions, use a single modify_transactions call with action "update", passing all confirmed transactions in the \`updates\` array to clear them in one batch.

6. Summarize what was done: how many transactions cleared, final balance, any adjustments made.

Let's start by fetching the uncleared transactions.`,
            },
          },
        ],
      };
    },
  );
}
