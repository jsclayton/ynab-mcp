import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.ts";
import { createServer } from "./server.ts";

const config = loadConfig();
const server = createServer(config);
const transport = new StdioServerTransport();

await server.connect(transport);
