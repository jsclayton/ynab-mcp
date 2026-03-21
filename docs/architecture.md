# Architecture

## Overview

```
┌─────────────────────────────────────────────────┐
│                   Entry Points                   │
│  stdio.ts (Claude Desktop)   http.ts (Hono/Edge)│
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │   server.ts    │  createServer(config) factory
              │   McpServer    │  wires tools, resources, prompts
              └───────┬────────┘
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │  Tools   │ │Resources │ │ Prompts  │
   │ (7 total)│ │(4 URIs)  │ │(3 flows) │
   └────┬─────┘ └────┬─────┘ └──────────┘
        │             │
        ▼             ▼
   ┌──────────────────────┐
   │       Cache          │  Delta sync, 5-min TTL
   │  accounts/cats/payees│  Invalidated after mutations
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │     YnabClient       │  fetch() wrapper, auth, errors
   │   api.ynab.com/v1    │  rate-limit tracking
   └──────────────────────┘
```

## Server Factory

`createServer(config)` in `src/server.ts` is the single wiring point:

1. Creates `YnabClient` with the access token
2. Creates `Cache` wrapping the client (with optional disk path)
3. Registers read-only tools (always)
4. Registers mutation tools (unless `readOnly`)
5. Registers resources and prompts
6. Returns the `McpServer` ready for a transport

Both entry points (`stdio.ts`, `http.ts`) call this factory and connect their respective transport.

## Transports

**stdio** (`src/stdio.ts`) — Uses `StdioServerTransport` from the MCP SDK. One server per process. Used by Claude Desktop.

**HTTP** (`src/http.ts`) — Hono app with `WebStandardStreamableHTTPServerTransport`. Supports multiple concurrent sessions via `mcp-session-id` header. Exposes `/health` and `/mcp` endpoints. Portable across Deno, Bun, Cloudflare Workers, etc.

## YNAB Client

`src/ynab/client.ts` — Thin `fetch()` wrapper using only Web Standard APIs.

- **Base URL:** `https://api.ynab.com/v1`
- **Auth:** Bearer token in `Authorization` header
- **Response unwrapping:** YNAB returns `{ data: T }` — the client returns just `T`
- **Error mapping:** HTTP status → descriptive error (401 → auth, 429 → rate limit with Retry-After)
- **Rate limits:** Tracks remaining requests from `X-Rate-Limit` header (`current/limit`)
- **Delta sync:** Many endpoints accept `last_knowledge_of_server` for incremental fetching

## Cache

`src/ynab/cache.ts` — In-memory delta-sync cache for reference data.

**Cached:** accounts, category groups (with nested categories), payees, currency format.
**Not cached:** transactions (too query-specific), month details.

**Flow:**
1. First call → full fetch, store items + `server_knowledge`
2. Within 5-min TTL → return cached data
3. After TTL → fetch with `last_knowledge_of_server`, merge deltas (update existing, add new, remove `deleted: true`)
4. After any mutation → `invalidate(planId)` resets TTL, forcing delta sync on next access

**Disk persistence** (optional): When `YNAB_CACHE_PATH` is set, writes `{path}/{planId}.json` after each fetch. On startup, loads from disk so delta sync resumes from last known state. Abstracted behind `DiskIO` interface for testability.

## Tool Design

7 tools consolidated via discriminator parameters:

| Tool | Discriminator | Operations |
|------|---------------|------------|
| `list_plans` | — | List budgets |
| `get_budget` | `view` | overview, month, category, scheduled, money_movements |
| `get_transactions` | — | Flexible search with filters |
| `modify_transactions` | `action` | create, update, delete, import |
| `modify_budget` | `action` | set_amount, update_category, set_goal |
| `modify_scheduled_transactions` | `action` | create, update, delete |
| `update_payee` | — | Rename payee |

This keeps the tool list small for the LLM while covering the full YNAB API surface.

## Formatters

`src/ynab/format.ts` — Pure functions that convert YNAB data to token-efficient text.

- **Currency:** Uses the plan's `CurrencyFormat` for symbol, decimals, separators — not hardcoded to USD. Negative amounts shown in parentheses.
- **Milliunits:** YNAB stores amounts as milliunits (÷1000 for dollars). `dollarsToMilliunits()` / `milliunitsToDollars()` handle conversion. Tool interfaces accept dollars.
- **Transactions:** Compact single-line format with cleared indicators (✓/•/R), optional memo line, subtransaction expansion.

## Portability

All shared code (`src/ynab/`, `src/tools/`, `src/resources/`, `src/prompts/`) uses only Web Standard APIs: `fetch`, `URL`, `Headers`, `Response`, `crypto.randomUUID()`. No `Deno.*`, `node:*`, or `Bun.*` imports. Runtime-specific APIs are isolated to:

- `stdio.ts` — `StdioServerTransport` (uses `node:process` internally, shimmed by Deno)
- `http.ts` — `Deno.serve()`
- `cache.ts` — `DiskIO` interface with `denoDiskIO` default implementation
