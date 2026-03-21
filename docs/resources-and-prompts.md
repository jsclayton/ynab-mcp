# Resources & Prompts

## Resources

Resources provide lookup data so the LLM can resolve names to IDs without making tool calls. They're automatically available to MCP clients.

### `ynab://plans`

Lists all budget plans with their IDs.

```
My Budget — abc12345-def6-7890-ghij-klmnopqrstuv
Joint Budget — fed98765-cba4-3210-zyxw-vutsrqponmlk
```

### `ynab://plans/{plan_id}/accounts`

Account names, types, balances, and IDs for a budget. Excludes closed and deleted accounts.

```
Checking (checking) — $5,234.56 — account-id-1
Savings (savings) — $12,000.00 — account-id-2
Credit Card (creditCard) — ($450.00) — account-id-3
```

### `ynab://plans/{plan_id}/categories`

Category group hierarchy with IDs and available balances. Excludes hidden and deleted items.

```
## Bills (group-id-1)
  Rent — Available: $0.00 — cat-id-1
  Utilities — Available: $75.00 — cat-id-2
## Food (group-id-2)
  Groceries — Available: $154.33 — cat-id-3
  Restaurants — Available: $45.00 — cat-id-4
```

### `ynab://plans/{plan_id}/payees`

All payee names mapped to their IDs. Excludes deleted payees.

```
Whole Foods — payee-id-1
Netflix — payee-id-2
Transfer: Savings — payee-id-3
```

---

## Prompts

Prompts are guided workflows that generate an initial message instructing Claude to chain multiple tool calls together. They're invoked from MCP clients that support the prompts capability.

### `reconcile_account`

Walk through reconciling a bank account against YNAB records.

| Argument | Type | Description |
|----------|------|-------------|
| `plan_id` | string | Budget plan ID |
| `account_id` | string | Account ID to reconcile |
| `bank_balance` | string | Current bank balance in dollars (e.g., `1234.56`) |

**Workflow:**
1. Fetches uncleared transactions for the account
2. Asks you to confirm each transaction ("Did this clear?")
3. Calculates expected balance: cleared balance + confirmed transactions
4. Compares to your bank balance — offers to create an adjustment if there's a discrepancy
5. Batch-clears all confirmed transactions
6. Summarizes: transactions cleared, final balance, any adjustments

### `spending_analysis`

Analyze spending patterns and budget health for a time period.

| Argument | Type | Description |
|----------|------|-------------|
| `plan_id` | string | Budget plan ID |
| `period` | string | Time period (e.g., `2024-01`, `2024-Q1`, `2024`, or `last-3-months`) |

**Produces:**
- **Summary** — Total income vs spending, net savings rate
- **Category breakdown** — Top spending categories, over-budget flags, unused budget
- **Trends** — Month-over-month changes (multi-month periods)
- **Top payees** — Highest spend and transaction frequency
- **Budget health** — Age of money, underfunded goals, recommendations

### `categorize_transactions`

Review and categorize uncategorized transactions with AI-suggested categories.

| Argument | Type | Description |
|----------|------|-------------|
| `plan_id` | string | Budget plan ID |

**Workflow:**
1. Loads your category structure
2. Fetches all uncategorized transactions
3. Suggests categories based on payee patterns, amounts, and similar past transactions
4. Presents suggestions in a table with confidence levels (High/Medium/Low)
5. Asks for approval — all at once, with modifications, or one by one
6. Batch-updates approved categorizations
7. Summarizes what was categorized
