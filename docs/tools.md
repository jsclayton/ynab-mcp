# Tools Reference

The server exposes 7 tools: 3 read-only (always available) and 4 mutation
(hidden when `YNAB_READ_ONLY=true`). All tools accept dollar amounts and convert
to YNAB milliunits internally.

---

## Read-Only Tools

### `list_plans`

Discover available budget plans. This is the entry point — call it first to get
plan IDs.

**Parameters:** None

**Example flow:**

> "What budgets do I have?" → `list_plans` → returns plan names and IDs

---

### `get_budget`

Budget data via a `view` parameter. Five views consolidate what would otherwise
be many separate tools.

| Parameter     | Type   | Required                           | Description                                                        |
| ------------- | ------ | ---------------------------------- | ------------------------------------------------------------------ |
| `plan_id`     | string | Yes                                | Budget plan ID (from `list_plans`)                                 |
| `view`        | enum   | Yes                                | `overview`, `month`, `category`, `scheduled`, or `money_movements` |
| `month`       | string | For month/category/money_movements | First of month in `YYYY-MM-DD` format (e.g., `2024-01-01`)         |
| `category_id` | string | For category                       | Category ID                                                        |

#### Views

**`overview`** — Start here. Returns on-budget and off-budget accounts with
balances, the current month summary (income, budgeted, activity, to-be-budgeted,
age of money), and category groups with counts and available totals.

**`month`** — Full budget for a specific month. All categories grouped by
category group, each showing budgeted, spent, and available amounts.

**`category`** — Deep dive into a single category for a given month. Includes
all goal details: type, target, progress percentage, months to budget,
underfunded amount, cadence, and creation date.

**`scheduled`** — All upcoming scheduled/recurring transactions with frequency,
amounts, payees, and next occurrence dates.

**`money_movements`** — How money was allocated across categories for a month.
Shows funded (positive) and reduced (negative) budget allocations, sorted by
amount.

---

### `get_transactions`

Flexible transaction search. Routes to the most specific YNAB API endpoint based
on which filter IDs are provided (account → category → payee → all).

| Parameter     | Type   | Required | Description                                                 |
| ------------- | ------ | -------- | ----------------------------------------------------------- |
| `plan_id`     | string | Yes      | Budget plan ID                                              |
| `account_id`  | string | No       | Filter to a specific account                                |
| `category_id` | string | No       | Filter to a specific category                               |
| `payee_id`    | string | No       | Filter to a specific payee                                  |
| `since_date`  | string | No       | Only transactions on or after this date (`YYYY-MM-DD`)      |
| `cleared`     | enum   | No       | `cleared`, `uncleared`, or `reconciled`                     |
| `type`        | enum   | No       | `uncategorized` or `unapproved`                             |
| `search`      | string | No       | Client-side search on payee name or memo (case-insensitive) |
| `limit`       | number | No       | Max results (default 50, max 200)                           |

Results are sorted newest-first. The output includes a net amount summary and
truncation notice when results exceed the limit.

**For reconciliation:** use `cleared: "uncleared"` + `account_id`.

---

## Mutation Tools

These tools are only available when `YNAB_READ_ONLY` is not `true`. All
invalidate the cache after successful operations.

### `modify_transactions`

All transaction writes through a single tool with an `action` discriminator.

| Parameter        | Type   | Required   | Description                               |
| ---------------- | ------ | ---------- | ----------------------------------------- |
| `plan_id`        | string | Yes        | Budget plan ID                            |
| `action`         | enum   | Yes        | `create`, `update`, `delete`, or `import` |
| `transactions`   | array  | For create | Array of new transactions                 |
| `updates`        | array  | For update | Array of transaction updates              |
| `transaction_id` | string | For delete | Transaction ID to remove                  |

#### Actions

**`create`** — Add one or more transactions. Each transaction requires `date`,
`amount` (in dollars), and `account_id`. Optional: `payee_name` or `payee_id`,
`category_id`, `memo`, `cleared`, `approved`.

**`update`** — Modify one or more existing transactions. Each update requires
`id` and any fields to change. Only provided fields are updated. Supports batch
clearing, categorizing, and editing.

**`delete`** — Permanently remove a transaction by ID.

**`import`** — Trigger sync from all linked bank accounts. No additional
parameters needed.

---

### `modify_budget`

Budget allocation and category management.

| Parameter          | Type    | Required                | Description                                    |
| ------------------ | ------- | ----------------------- | ---------------------------------------------- |
| `plan_id`          | string  | Yes                     | Budget plan ID                                 |
| `action`           | enum    | Yes                     | `set_amount`, `update_category`, or `set_goal` |
| `month`            | string  | For set_amount/set_goal | Month in `YYYY-MM-DD` format                   |
| `category_id`      | string  | For all actions         | Category ID                                    |
| `amount`           | number  | For set_amount          | Budget amount in dollars                       |
| `name`             | string  | For update_category     | New category name                              |
| `hidden`           | boolean | For update_category     | Show or hide a category                        |
| `goal_target`      | number  | For set_goal            | Goal target amount in dollars                  |
| `goal_target_date` | string  | For set_goal            | Goal target date (`YYYY-MM-DD`)                |

> **Note:** Creating new categories and category groups requires the YNAB app —
> the API doesn't support it.

---

### `modify_scheduled_transactions`

Manage recurring transactions.

| Parameter                  | Type   | Required          | Description                     |
| -------------------------- | ------ | ----------------- | ------------------------------- |
| `plan_id`                  | string | Yes               | Budget plan ID                  |
| `action`                   | enum   | Yes               | `create`, `update`, or `delete` |
| `scheduled_transaction_id` | string | For update/delete | Scheduled transaction ID        |
| `date_first`               | string | For create        | First occurrence (`YYYY-MM-DD`) |
| `frequency`                | enum   | For create        | See frequencies below           |
| `amount`                   | number | For create/update | Amount in dollars               |
| `account_id`               | string | For create        | Account ID                      |
| `payee_id`                 | string | No                | Existing payee ID               |
| `payee_name`               | string | No                | Payee name                      |
| `category_id`              | string | No                | Category ID                     |
| `memo`                     | string | No                | Memo                            |

**Frequencies:** `never`, `daily`, `weekly`, `everyOtherWeek`, `twiceAMonth`,
`every4Weeks`, `monthly`, `everyOtherMonth`, `every3Months`, `every4Months`,
`twiceAYear`, `yearly`, `everyOtherYear`

---

### `update_payee`

Rename a payee for cleaner transaction history. This is idempotent.

| Parameter  | Type   | Required | Description        |
| ---------- | ------ | -------- | ------------------ |
| `plan_id`  | string | Yes      | Budget plan ID     |
| `payee_id` | string | Yes      | Payee ID to rename |
| `name`     | string | Yes      | New payee name     |
