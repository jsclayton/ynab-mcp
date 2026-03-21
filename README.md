# ynab-mcp

An MCP server that connects Claude to [YNAB](https://ynab.com) (You Need A
Budget) — enabling financial analysis, guided reconciliation, and budget
management through natural conversation.

## Quick Start

### Prerequisites

- [Deno](https://deno.com) v2+
- A [YNAB Personal Access Token](https://app.ynab.com/settings/developer)

### Claude Desktop

Add to your Claude Desktop config
(`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "ynab": {
      "command": "deno",
      "args": [
        "run",
        "--allow-net",
        "--allow-env",
        "--allow-read",
        "/path/to/ynab-mcp/src/stdio.ts"
      ],
      "env": {
        "YNAB_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

Restart Claude Desktop. Ask _"Show me my budget overview"_ to get started.

### Claude Code

```bash
export YNAB_ACCESS_TOKEN=your-token-here
deno task start
```

### HTTP Server

```bash
export YNAB_ACCESS_TOKEN=your-token-here
deno task serve
# → http://localhost:8080/mcp
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

## Documentation

- [Tools Reference](docs/tools.md) — All 7 tools with parameters and examples
- [Resources & Prompts](docs/resources-and-prompts.md) — Lookup resources and
  guided workflows
- [Architecture](docs/architecture.md) — How the server is structured
- [Development](docs/development.md) — Running tests, adding tools, contributing

## License

[AGPL-3.0](LICENSE.txt)
