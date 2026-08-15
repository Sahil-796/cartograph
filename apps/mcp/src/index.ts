#!/usr/bin/env node
/**
 * `cartograph-mcp` — the MCP front door onto the query registry.
 *
 * Three doors feed the same nine-plus-query registry: REST
 * (`apps/api`), chat (Groq function-calling), and this stdio MCP server.
 * All three resolve queries through `@cartograph/graph`'s `getQuery` /
 * `executeQuery` and render tool schemas through `@cartograph/tools`; this
 * file's only job is stdio transport wiring and env bootstrap.
 *
 * Import order matters: `./env.js` must load the root `.env` before
 * `./server.js` (transitively `@cartograph/graph` -> `@cartograph/config`)
 * is imported, because the config singleton validates `process.env` at
 * import time and exits the process if required vars are missing.
 */
import "./env.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the MCP transport itself — every log must go to stderr, or
  // it corrupts the JSON-RPC stream Claude Code is parsing on the other
  // end.
  console.error("cartograph-mcp: listening on stdio");
}

main().catch((err) => {
  console.error("cartograph-mcp: fatal error during startup:", err);
  process.exitCode = 1;
});
