import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReconciliationPrompt } from "./reconciliation.ts";
import { registerSpendingAnalysisPrompt } from "./spending-analysis.ts";
import { registerCategorizePrompt } from "./categorize.ts";

export function registerPrompts(server: McpServer): void {
  registerReconciliationPrompt(server);
  registerSpendingAnalysisPrompt(server);
  registerCategorizePrompt(server);
}
