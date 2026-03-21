/**
 * YNAB MCP server over stdio transport.
 *
 * Run directly to start the server for Claude Desktop or Claude Code:
 * ```
 * YNAB_ACCESS_TOKEN=... deno run --allow-net --allow-env jsr:@jsclayton/ynab-mcp
 * ```
 *
 * @module
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.ts";
import { createServer } from "./server.ts";

const config = loadConfig();
const server = createServer(config);
const transport = new StdioServerTransport();

await server.connect(transport);
