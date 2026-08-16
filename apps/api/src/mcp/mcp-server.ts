/**
 * Builds the embedded MCP `Server` instance for the Nest app.
 *
 * This is the HTTP-homed mirror of `apps/mcp/src/server.ts`: it registers the
 * exact same two handlers (tools/list + tools/call) over the exact same
 * `@cartograph/graph` registry and `@cartograph/tools` renderings. The
 * difference is where the dependencies come from — `loadMcpDeps()` (the
 * tsx/ESM bridge) and `loadSdk()` (the CJS `require` of the SDK) instead of a
 * static ESM import — and that the transport is attached by the controller
 * (HTTP), not by this function (stdio).
 */

import { loadSdk, type McpServerHandle } from './mcp-sdk';
import type { McpGraphDeps } from './mcp-graph-loader';

/** A fresh, unconnected MCP server exposing the full query registry as tools. */
export function createMcpServer(deps: McpGraphDeps): McpServerHandle {
  const { Server, types } = loadSdk();
  const server = new Server(
    { name: 'cartograph', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(types.ListToolsRequestSchema, async () => {
    return { tools: deps.toMcpTools() };
  });

  server.setRequestHandler(types.CallToolRequestSchema, async (request) => {
    const params = request.params as { name: string; arguments?: Record<string, unknown> };
    const { name, arguments: args } = params;

    const def = deps.getQuery(name);
    if (!def) {
      const validNames = deps.queries.map((q) => q.name).join(', ');
      return errorResult(`unknown tool "${name}" — valid names: ${validNames}`);
    }

    // Pre-validate with `safeParse` for a deliberate, readable error path —
    // same reasoning as the REST controller and the stdio MCP server.
    const parsed = def.params.safeParse(args ?? {});
    if (!parsed.success) {
      return errorResult(`invalid parameters for "${name}": ${formatZodError(parsed.error)}`);
    }

    try {
      const rows = await deps.executeQuery(def, parsed.data);
      return {
        content: [{ type: 'text', text: JSON.stringify({ name: def.name, rows }, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult(`query "${name}" failed: ${message}`);
    }
  });

  return server;
}

function errorResult(message: string): { content: { type: string; text: string }[]; isError: boolean } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function formatZodError(error: { issues: { path: (string | number)[]; message: string }[] }): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}
