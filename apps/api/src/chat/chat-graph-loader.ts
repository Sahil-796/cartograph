/**
 * ESM/CJS boundary crossing for the chat surface.
 *
 * This mirrors `apps/api/src/query/graph-loader.ts` (read that file's long
 * comment for the full rationale) but pulls in BOTH ESM-only packages the
 * chat loop needs: `@cartograph/graph` (for `getQuery`/`executeQuery`) and
 * `@cartograph/tools` (for `toOpenAITools`). Both ship as raw, unbuilt
 * TypeScript and are ESM-only, so a CommonJS Nest app can't `require()`
 * them: TypeScript's CJS emit would downlevel a static import into a
 * `require()` that can't load ESM. The fix is a genuine dynamic `import()`
 * built via `new Function(...)` (a string tsc never parses as an import, so
 * it can't downlevel it), after registering `tsx/esm/api`'s loader hooks so
 * Node can resolve the packages' `.js`-specifier-for-`.ts` imports and strip
 * types. Registered once, lazily, on first chat request.
 */
import type * as GraphModule from '@cartograph/graph';

/**
 * Structural mirror of `@cartograph/tools`' `OpenAITool` (Groq's
 * OpenAI-compatible tool schema). Declared locally rather than imported from
 * `@cartograph/tools` on purpose: importing a type from that package drags
 * its `zod-to-json-schema` source into tsc's program, which trips a known
 * "excessively deep" instantiation error under this app's tsconfig. The real
 * `toOpenAITools()` is still called at runtime via the dynamic import below.
 */
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

let tsxRegistered = false;

/** The narrow slice of both ESM packages the chat loop consumes. */
export interface ChatGraphDeps {
  getQuery: typeof GraphModule.getQuery;
  executeQuery: typeof GraphModule.executeQuery;
  toOpenAITools: () => OpenAITool[];
}

let depsPromise: Promise<ChatGraphDeps> | undefined;

async function load(): Promise<ChatGraphDeps> {
  if (!tsxRegistered) {
    tsxRegistered = true;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { register } = require('tsx/esm/api') as { register: () => void };
    register();
  }
  const [graph, tools] = (await Promise.all([
    dynamicImport('@cartograph/graph'),
    dynamicImport('@cartograph/tools'),
  ])) as [typeof GraphModule, { toOpenAITools: () => OpenAITool[] }];

  return {
    getQuery: graph.getQuery,
    executeQuery: graph.executeQuery,
    toOpenAITools: () => tools.toOpenAITools(),
  };
}

/** Loads `@cartograph/graph` + `@cartograph/tools` via real dynamic imports, once, and caches the result. */
export function loadChatDeps(): Promise<ChatGraphDeps> {
  if (!depsPromise) depsPromise = load();
  return depsPromise;
}
