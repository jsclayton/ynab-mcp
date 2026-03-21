import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { loadConfig } from "./config.ts";
import { createServer } from "./server.ts";

const config = loadConfig();

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

// Map to track transports by session ID
const transports = new Map<
  string,
  WebStandardStreamableHTTPServerTransport
>();

app.all("/mcp", async (c) => {
  // Check for existing session
  const sessionId = c.req.header("mcp-session-id");
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    // New session — create server + transport
    const server = createServer(config);
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport!);
      },
    });
    await server.connect(transport);
  }

  return transport.handleRequest(c.req.raw);
});

const port = parseInt(Deno.env.get("PORT") ?? "8080");
console.log(`YNAB MCP server listening on http://localhost:${port}`);
console.log(`  Health: http://localhost:${port}/health`);
console.log(`  MCP:    http://localhost:${port}/mcp`);

Deno.serve({ port }, app.fetch);
