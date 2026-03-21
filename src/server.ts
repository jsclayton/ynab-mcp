import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.ts";
import { YnabClient } from "./ynab/client.ts";
import { Cache } from "./ynab/cache.ts";
import { registerPlanTools } from "./tools/plans.ts";
import { registerBudgetTools } from "./tools/budget.ts";
import { registerTransactionTools } from "./tools/transactions.ts";
import { registerMutationTools } from "./tools/mutations.ts";
import { registerResources } from "./resources/index.ts";
import { registerPrompts } from "./prompts/index.ts";

export function createServer(config: Config): McpServer {
  const server = new McpServer({
    name: "ynab",
    version: "0.1.0",
  });

  const client = new YnabClient(config.accessToken);
  const cache = new Cache(client, config.cachePath);

  // Read-only tools — always registered
  registerPlanTools(server, client);
  registerBudgetTools(server, client, cache);
  registerTransactionTools(server, client, cache);

  // Mutation tools — only when not read-only
  if (!config.readOnly) {
    registerMutationTools(server, client, cache);
  }

  // Resources & prompts
  registerResources(server, client, cache);
  registerPrompts(server);

  return server;
}
