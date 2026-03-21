import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerApprovePrompt(server: McpServer): void {
  server.prompt(
    "approve_transactions",
    "Review and approve unapproved transactions — merge duplicates, verify matches, then bulk approve",
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
              text: `Help me review and approve my unapproved transactions.

Budget Plan ID: ${plan_id}

Please follow these steps in order:

## Step 1: Fetch data

- Use get_budget with plan_id="${plan_id}" and view="overview" to understand my accounts and categories.
- Use get_budget with plan_id="${plan_id}" and view="scheduled" to see my scheduled transactions.
- Use get_transactions with plan_id="${plan_id}" and type="unapproved" to fetch all unapproved transactions.

If there are no unapproved transactions, let me know and we're done!

## Step 2: Find duplicates from scheduled transactions

Look for unapproved transactions that appear to be duplicates of scheduled transactions — this commonly happens with variable-amount bills (utilities, insurance, etc.) where the bank import and the scheduled transaction both created entries.

Identify pairs by matching:
- Same or similar payee name
- Similar amount (within ~20% for variable bills)
- Close dates (within a few days)

Present any duplicates in a table:
| Bank Import | Amount | Scheduled Entry | Amount | Date Diff |

Ask me which to keep (usually the bank import with the actual amount). Delete the duplicate using modify_transactions with action "delete".

## Step 3: Verify auto-matched transactions

Look for unapproved transactions that have a "Matched:" line in their output — these were auto-matched by YNAB. Flag any risky matches where:
- Multiple transactions have the same dollar amount near the same date (could match wrong)
- The matched transaction ID seems unexpected

Present flagged matches for my review. If any are wrong, I'll tell you what to fix.

## Step 4: Review remaining unapproved transactions

Group the remaining unapproved transactions:

**Quick approval** — transactions with common, obvious categories (restaurants, groceries, gas, subscriptions, etc.):
| Date | Payee | Amount | Category | Account |

**Needs review** — transactions with unusual payees, missing categories, or that seem unexpected:
| Date | Payee | Amount | Category | Account | Notes |

Ask me to:
- Approve all quick-approval transactions
- Review each needs-review transaction (I may recategorize some)
- Or go through everything one by one

## Step 5: Batch approve

After I confirm, use a single modify_transactions call with action "update", passing ALL approved transactions in the \`updates\` array with \`approved: true\`. Do NOT loop one at a time.

## Step 6: Summary

Summarize what was done:
- Duplicates merged (deleted)
- Matches verified
- Transactions approved (count, by category breakdown)
- Any remaining unapproved transactions

Let's start!`,
            },
          },
        ],
      };
    },
  );
}
