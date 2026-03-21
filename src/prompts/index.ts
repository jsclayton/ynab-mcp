import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerApprovePrompt } from "./approve.ts";
import { registerReconciliationPrompt } from "./reconciliation.ts";
import { registerSpendingAnalysisPrompt } from "./spending-analysis.ts";
import { registerCategorizePrompt } from "./categorize.ts";

export function registerPrompts(server: McpServer): void {
  registerApprovePrompt(server);
  registerReconciliationPrompt(server);
  registerSpendingAnalysisPrompt(server);
  registerCategorizePrompt(server);
}
