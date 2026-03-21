# Development

## Setup

```bash
# Clone and install dependencies (Deno fetches on first run)
deno task test
```

## Commands

| Command                | Description                      |
| ---------------------- | -------------------------------- |
| `deno task test`       | Run all tests                    |
| `deno task test:watch` | Run tests in watch mode          |
| `deno task check`      | Type-check entry points          |
| `deno task lint`       | Lint all source files            |
| `deno task fmt`        | Format all source files          |
| `deno task start`      | Run stdio server                 |
| `deno task serve`      | Run HTTP server (port 8080)      |
| `deno task dev`        | Run stdio server with watch mode |

Run a single test file:

```bash
deno test --allow-env --allow-read src/ynab/format_test.ts
```

## Project Layout

```
src/
  config.ts              # Environment variable loading
  server.ts              # McpServer factory — wires everything
  stdio.ts               # Entry: stdio transport
  http.ts                # Entry: Hono HTTP transport
  ynab/
    types.ts             # YNAB API response types
    client.ts            # Fetch wrapper with auth, errors, rate limits
    cache.ts             # Delta-sync cache with optional disk persistence
    format.ts            # Milliunits→currency, transaction/account formatters
  tools/
    plans.ts             # list_plans
    budget.ts            # get_budget (5 views)
    transactions.ts      # get_transactions
    mutations.ts         # modify_transactions, modify_budget, modify_scheduled_transactions, update_payee
  resources/
    index.ts             # ynab:// URI resources
  prompts/
    index.ts             # Prompt registration
    reconciliation.ts    # reconcile_account workflow
    spending-analysis.ts # spending_analysis workflow
    categorize.ts        # categorize_transactions workflow
  testing/
    helpers.ts           # mockFetch(), fixture factories
```

Tests are co-located: `foo.ts` has `foo_test.ts` in the same directory.

## Testing

All tests mock `globalThis.fetch` — no real YNAB API calls are made.

### `mockFetch()`

Central test utility from `src/testing/helpers.ts`. Intercepts fetch calls,
matches by URL pattern (string or regex) and HTTP method, returns canned
responses.

```typescript
import { makePlan, mockFetch } from "../testing/helpers.ts";

let fetchMock: ReturnType<typeof mockFetch>;

beforeEach(() => {
  fetchMock = mockFetch();
});

afterEach(() => {
  fetchMock.restore();
});

it("fetches plans", async () => {
  fetchMock.mock("/v1/budgets", {
    data: { budgets: [makePlan({ name: "Test" })] },
  });

  const client = new YnabClient("test-token");
  const result = await client.getPlans();
  assertEquals(result.budgets[0].name, "Test");
  assertEquals(fetchMock.calls.length, 1);
});
```

### Fixture Factories

`makePlan()`, `makeAccount()`, `makeCategory()`, `makeCategoryGroup()`,
`makePayee()`, `makeTransaction()`, `makeSubTransaction()`,
`makeScheduledTransaction()`, `makeMonthDetail()`, `makeMonthSummary()`

Each produces a complete, valid YNAB entity with sensible defaults. Pass
`Partial<T>` to override specific fields:

```typescript
makeTransaction({ amount: -50000, cleared: "uncleared" });
```

## Adding a Tool

1. Create `src/tools/my_tool.ts` exporting
   `registerMyTools(server, client, cache)`
2. Use `server.tool(name, description, zodSchema, annotations, handler)`
3. Import and call from `src/server.ts` in `createServer()`
4. Create `src/tools/my_tool_test.ts` with mockFetch-based tests
5. Run `deno task test` and `deno task check`

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on push to `main` and all PRs:

1. `deno fmt --check`
2. `deno lint`
3. `deno check src/stdio.ts src/http.ts`
4. `deno test --allow-env --allow-read src/`
