import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YnabClient } from "../ynab/client.ts";
import { formatPlan } from "../ynab/format.ts";

export function registerPlanTools(server: McpServer, client: YnabClient): void {
  server.tool(
    "list_plans",
    "List all available YNAB budget plans. Use this first to discover plan IDs.",
    {},
    { readOnlyHint: true, openWorldHint: true },
    async () => {
      const data = await client.getPlans();
      const plans = data.budgets;

      if (plans.length === 0) {
        return {
          content: [{ type: "text", text: "No budget plans found." }],
        };
      }

      const text = plans
        .map((p) => `${formatPlan(p)}\n  ID: ${p.id}`)
        .join("\n\n");
      return {
        content: [{ type: "text", text }],
      };
    },
  );
}
