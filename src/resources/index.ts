import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YnabClient } from "../ynab/client.ts";
import type { Cache } from "../ynab/cache.ts";
import { formatMoney } from "../ynab/format.ts";

export function registerResources(
  server: McpServer,
  client: YnabClient,
  cache: Cache,
): void {
  // 1. ynab://plans — list all budget plans with IDs
  server.resource(
    "plans",
    "ynab://plans",
    { description: "List of all YNAB budget plans with their IDs" },
    async (uri) => {
      const data = await client.getPlans();
      const text = data.budgets
        .map((b) => `${b.name} — ${b.id}`)
        .join("\n");
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/plain",
          text,
        }],
      };
    },
  );

  // 2. ynab://plans/{plan_id}/accounts — accounts with types, IDs, balances
  server.resource(
    "accounts",
    new ResourceTemplate("ynab://plans/{plan_id}/accounts", {
      list: undefined,
    }),
    {
      description: "Account names, types, IDs, and balances for a budget plan",
    },
    async (uri, variables) => {
      const planId = variables.plan_id as string;
      const accounts = await cache.getAccounts(planId);
      const currency = await cache.getCurrencyFormat(planId);
      const text = accounts
        .filter((a) => !a.deleted && !a.closed)
        .map((a) =>
          `${a.name} (${a.type}) — ${
            formatMoney(a.balance, currency)
          } — ${a.id}`
        )
        .join("\n");
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/plain",
          text,
        }],
      };
    },
  );

  // 3. ynab://plans/{plan_id}/categories — category hierarchy with IDs and balances
  server.resource(
    "categories",
    new ResourceTemplate("ynab://plans/{plan_id}/categories", {
      list: undefined,
    }),
    {
      description:
        "Category group hierarchy with IDs and balances for a budget plan",
    },
    async (uri, variables) => {
      const planId = variables.plan_id as string;
      const groups = await cache.getCategoryGroups(planId);
      const currency = await cache.getCurrencyFormat(planId);
      const lines: string[] = [];
      for (const group of groups) {
        if (group.deleted || group.hidden) continue;
        lines.push(`## ${group.name} (${group.id})`);
        for (const cat of group.categories) {
          if (cat.deleted || cat.hidden) continue;
          lines.push(
            `  ${cat.name} — Available: ${
              formatMoney(cat.balance, currency)
            } — ${cat.id}`,
          );
        }
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/plain",
          text: lines.join("\n"),
        }],
      };
    },
  );

  // 4. ynab://plans/{plan_id}/payees — payee names to IDs
  server.resource(
    "payees",
    new ResourceTemplate("ynab://plans/{plan_id}/payees", { list: undefined }),
    { description: "Payee names and IDs for a budget plan" },
    async (uri, variables) => {
      const planId = variables.plan_id as string;
      const payees = await cache.getPayees(planId);
      const text = payees
        .filter((p) => !p.deleted)
        .map((p) => `${p.name} — ${p.id}`)
        .join("\n");
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/plain",
          text,
        }],
      };
    },
  );
}
