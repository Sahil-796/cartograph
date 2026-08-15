import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { ZodIssue } from "zod";
import { ZodError } from "zod";
import { getQuery, executeQuery, queries } from "@cartograph/graph";
import { toMcpTools } from "@cartograph/tools";

/**
 * Builds the MCP `Server` instance — no transport wiring here, so tests
 * (and any future non-stdio transport) can construct one without touching
 * stdin/stdout.
 *
 * This exposes the EXACT SAME query registry the REST controller
 * (`apps/api/src/query/query.controller.ts`) and chat surface use:
 * `tools/list` is `toMcpTools()` from `@cartograph/tools` (itself derived
 * mechanically from `@cartograph/graph`'s `QueryDef.params`), and
 * `tools/call` runs `getQuery` + `executeQuery` — the identical lookup and
 * execution path REST uses, just wrapped for the MCP result shape instead
 * of an HTTP response.
 */
export function createServer(): Server {
  const server = new Server(
    { name: "cartograph", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: toMcpTools() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;

    const def = getQuery(name);
    if (!def) {
      const validNames = queries.map((q) => q.name).join(", ");
      return errorResult(`unknown tool "${name}" — valid names: ${validNames}`);
    }

    // Pre-validate with `safeParse` rather than letting `executeQuery`
    // throw a raw `ZodError` — same reasoning as the REST controller: a
    // deliberate, readable error path instead of a catch-and-reclassify
    // around `executeQuery`'s internal `.parse()`.
    const parsed = def.params.safeParse(args ?? {});
    if (!parsed.success) {
      return errorResult(`invalid parameters for "${name}": ${formatZodError(parsed.error)}`);
    }

    try {
      const rows = await executeQuery(def, parsed.data);
      return {
        content: [{ type: "text", text: JSON.stringify({ name: def.name, rows }, null, 2) }],
      };
    } catch (err) {
      // A DB error (bad connection, Cypher failure, etc.) must never
      // crash the process — stdio MCP has no supervisor to restart it
      // mid-session. Report it as a tool error and keep the server alive.
      if (err instanceof ZodError) {
        return errorResult(`invalid parameters for "${name}": ${formatZodError(err)}`);
      }
      const message = err instanceof Error ? err.message : String(err);
      return errorResult(`query "${name}" failed: ${message}`);
    }
  });

  return server;
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue: ZodIssue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
