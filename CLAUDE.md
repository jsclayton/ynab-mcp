# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Commands

```bash
deno task test              # Run all tests
deno test --allow-env --allow-read src/ynab/client_test.ts  # Run a single test file
deno task test:watch        # Tests in watch mode
deno task check             # Type-check (src/stdio.ts + src/http.ts)
deno task lint              # Lint
deno task fmt               # Format
deno task start             # Run stdio server
deno task serve             # Run HTTP server (port 8080)
```

CI runs: `deno fmt --check`, `deno lint`, `deno check`, `deno test` (see
`.github/workflows/ci.yml`).

## Architecture

MCP server exposing YNAB's API as tools, resources, and prompts. Two transports:
stdio (`src/stdio.ts` for Claude Desktop) and HTTP (`src/http.ts` via Hono for
edge deployment).

**`src/server.ts`** — Factory `createServer(config)` wires everything: creates
`YnabClient` → `Cache` → registers tools/resources/prompts on `McpServer`.
Mutation tools are only registered when `YNAB_READ_ONLY` is not `true`.

**`src/ynab/client.ts`** — Thin `fetch()` wrapper. All methods return the
unwrapped `data` property from YNAB's `{ data: T }` response envelope. Supports
`last_knowledge_of_server` for delta sync. Tracks rate limits from
`X-Rate-Limit` header.

**`src/ynab/cache.ts`** — In-memory delta-sync cache for accounts, categories,
payees (NOT transactions). 5-minute TTL; after expiry, fetches with
`server_knowledge` and merges deltas. `invalidate(planId)` is called after every
mutation. Optional disk persistence via `DiskIO` interface.

**`src/ynab/format.ts`** — Pure formatters. All monetary values in YNAB are
milliunits (÷1000 for dollars). `formatMoney()` uses the plan's `CurrencyFormat`
for symbol, decimals, separators — not hardcoded to USD.

## Tool design

7 tools total: 3 read-only, 4 mutation. Tools use `view`/`action` discriminator
params to consolidate related operations (e.g., `get_budget` has 5 views;
`modify_transactions` has create/update/delete/import actions). Dollar amounts
in tool interfaces are auto-converted to/from milliunits.

## Test patterns

Tests are co-located (`foo.ts` + `foo_test.ts`). Use `@std/testing/bdd`
(`describe`/`it`) and `@std/testing/assert`. All tests mock `globalThis.fetch`
via `mockFetch()` from `src/testing/helpers.ts` — no real API calls. Fixture
factories (`makePlan()`, `makeTransaction()`, etc.) produce complete YNAB
entities with sensible defaults and accept `Partial<T>` overrides.

Standard test setup:

```typescript
let fetchMock: ReturnType<typeof mockFetch>;
beforeEach(() => {
  fetchMock = mockFetch();
});
afterEach(() => {
  fetchMock.restore();
});
```

## Key conventions

- Imports use bare specifiers mapped in `deno.json` (e.g.,
  `"@std/testing/assert"`, `"zod"`), never inline `jsr:` or `npm:` prefixes in
  source files.
- No `Deno.*` or `node:*` APIs in shared code (`src/ynab/`, `src/tools/`,
  `src/resources/`, `src/prompts/`). Runtime-specific APIs are isolated to entry
  points and the `DiskIO` abstraction.
- Public client methods are not `async` — they return `this.request(...)`
  directly (Deno's `require-await` lint rule).
- Every tool response includes a `"Budget: {name}"` header line for context.
