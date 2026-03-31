# ynab-mcp

An MCP server that connects Claude to [YNAB](https://ynab.com) (You Need A
Budget) — enabling financial analysis, guided reconciliation, and budget
management through natural conversation.

## Quick Start

### Prerequisites

- [Deno](https://docs.deno.com/runtime/getting_started/installation/) v2+
- A [YNAB Personal Access Token](https://app.ynab.com/settings/developer)

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "ynab": {
      "command": "deno",
      "args": ["run", "--allow-net", "--allow-env", "jsr:@jsclayton/ynab-mcp"],
      "env": {
        "YNAB_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

Restart Claude Desktop. Ask _"Show me my budget overview"_ to get started.

> **From source:** Replace the JSR specifier with the path to `src/stdio.ts` if running from a local clone.

### Claude Code

```bash
YNAB_ACCESS_TOKEN=your-token-here deno run --allow-net --allow-env jsr:@jsclayton/ynab-mcp
```

### HTTP Server

```bash
YNAB_ACCESS_TOKEN=your-token-here deno run --allow-net --allow-env jsr:@jsclayton/ynab-mcp/http
# → http://localhost:8080/mcp
```

### Docker

```bash
docker run -d \
  -e YNAB_ACCESS_TOKEN=your-token-here \
  -p 8080:8080 \
  ghcr.io/jsclayton/ynab-mcp:latest
# → http://localhost:8080/mcp
```

The image includes a health check on `/health`. All [configuration](#configuration)
is passed via environment variables. To persist the cache across restarts, mount
a volume:

```bash
docker run -d \
  -e YNAB_ACCESS_TOKEN=your-token-here \
  -e YNAB_CACHE_PATH=/cache \
  -v ynab-cache:/cache \
  -p 8080:8080 \
  ghcr.io/jsclayton/ynab-mcp:latest
```

## What You Can Do

**Analyze spending** — Break down spending by category, track trends over time,
find your top payees, and spot over-budget categories.

**Reconcile accounts** — Walk through uncleared transactions one by one, compare
against your bank balance, and batch-clear confirmed transactions.

**Categorize transactions** — Review uncategorized transactions with
AI-suggested categories based on payee patterns, then batch-update with
approval.

**Manage your budget** — Create transactions, adjust budget amounts, update
goals, rename payees, and manage scheduled transactions.

## Configuration

| Variable               | Required | Default | Description                                                      |
| ---------------------- | -------- | ------- | ---------------------------------------------------------------- |
| `YNAB_ACCESS_TOKEN`    | Yes      | —       | [Personal access token](https://app.ynab.com/settings/developer) |
| `YNAB_READ_ONLY`       | No       | `false` | Set to `true` to hide all mutation tools                         |
| `YNAB_DEFAULT_PLAN_ID` | No       | —       | Default budget plan ID                                           |
| `YNAB_CACHE_PATH`      | No       | —       | Directory for persistent cache (e.g., `~/.cache/ynab-mcp`)       |
| `PORT`                 | No       | `8080`  | HTTP server port (HTTP transport only)                           |

## Documentation

- [Tools Reference](docs/tools.md) — All 7 tools with parameters and examples
- [Resources & Prompts](docs/resources-and-prompts.md) — Lookup resources and
  guided workflows
- [Architecture](docs/architecture.md) — How the server is structured
- [Development](docs/development.md) — Running tests, adding tools, contributing

## License

[AGPL-3.0](LICENSE.txt)
