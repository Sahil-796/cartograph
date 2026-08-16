/**
 * ESM/CJS boundary crossing for the embedded MCP surface.
 *
 * Structural mirror of `apps/api/src/chat/chat-graph-loader.ts` — same trick,
 * same rationale — but the MCP surface needs the tool renderings in MCP's
 * JSON-Schema shape (`toMcpTools`) rather than Groq's OpenAI-compatible shape
 * (`toOpenAITools`). Both `@cartograph/graph` and `@cartograph/tools` ship as
 * raw, unbuilt, ESM-only TypeScript, so a CommonJS Nest app can't `require()`
 * them; the `new Function("return import(...)")` bridge after registering
 * `tsx/esm/api` is the one way this app can reach them (see
 * `apps/api/src/query/graph-loader.ts` for the full write-up).
 */
import type * as GraphModule from '@cartograph/graph';

/**
 * Structural mirror of `@cartograph/tools`' `McpTool`. Declared locally rather
 * than imported from `@cartograph/tools` for the same reason the chat loader
 * mirrors `OpenAITool`: importing a type from that package drags
 * `zod-to-json-schema`'s types into tsc's program, which trips a known
 * "excessively deep" instantiation error under this app's tsconfig. The real
 * `toMcpTools()` is still called at runtime via the dynamic import below.
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

let tsxRegistered = false;

/** The narrow slice of both ESM packages the embedded MCP server consumes. */
export interface McpGraphDeps {
  getQuery: typeof GraphModule.getQuery;
  executeQuery: typeof GraphModule.executeQuery;
  queries: typeof GraphModule.queries;
  toMcpTools: () => McpTool[];
}

let depsPromise: Promise<McpGraphDeps> | undefined;

async function load(): Promise<McpGraphDeps> {
  if (!tsxRegistered) {
    tsxRegistered = true;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { register } = require('tsx/esm/api') as { register: () => void };
    register();
  }
  const [graph, tools] = (await Promise.all([
    dynamicImport('@cartograph/graph'),
    dynamicImport('@cartograph/tools'),
  ])) as [typeof GraphModule, { toMcpTools: () => McpTool[] }];

  return {
    getQuery: graph.getQuery,
    executeQuery: graph.executeQuery,
    queries: graph.queries,
    toMcpTools: () => tools.toMcpTools(),
  };
}

/** Loads `@cartograph/graph` + `@cartograph/tools` via real dynamic imports, once, and caches the result. */
export function loadMcpDeps(): Promise<McpGraphDeps> {
  if (!depsPromise) depsPromise = load();
  return depsPromise;
}
