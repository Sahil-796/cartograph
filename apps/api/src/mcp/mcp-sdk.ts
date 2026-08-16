/**
 * The MCP SDK, accessed from a CommonJS Nest app.
 *
 * Runtime: the SDK ships compiled JS with BOTH an ESM and a CJS build — its
 * `exports` map routes `require` to `dist/cjs/*`. So the runtime story is a
 * plain `require()`, no `tsx`/dynamic-import bridge needed (unlike
 * `@cartograph/graph`/`@cartograph/tools`, which are raw unbuilt TypeScript).
 *
 * Compile time: this app's tsconfig uses `moduleResolution: "Node"` (node10),
 * which cannot follow a package `exports` map. A static
 * `import { Server } from "@modelcontextprotocol/sdk/server/index.js"` would
 * fail to resolve types, and there is no top-level `types`/`main` field to
 * fall back on. So the SDK is loaded here with `require()` and cast to the
 * narrow structural types this surface actually uses — the same pattern as
 * the `tsx/esm/api` `require` in `chat-graph-loader.ts`.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/** The MCP SDK `Server` surface the embedded server uses. */
export interface McpServerHandle {
  setRequestHandler(schema: unknown, handler: (request: { params: unknown }) => unknown): void;
  connect(transport: McpTransport): Promise<void>;
}

/** The MCP SDK `StreamableHTTPServerTransport` surface. */
export interface McpTransport {
  /** The session id this transport serves, after initialization. */
  sessionId?: string;
  handleRequest(
    req: IncomingMessage & { body?: unknown },
    res: ServerResponse,
    parsedBody?: unknown,
  ): Promise<void>;
}

/** Options accepted by `StreamableHTTPServerTransport`'s constructor. */
export interface McpTransportOptions {
  sessionIdGenerator?: () => string;
  onsessioninitialized?: (sessionId: string) => void;
  onsessionclosed?: (sessionId: string) => void;
}

/** The part of the SDK's `types.js` module the server builder references. */
export interface McpSdkTypes {
  ListToolsRequestSchema: unknown;
  CallToolRequestSchema: unknown;
}

/** A resolved handle onto the three SDK modules the MCP surface needs. */
export interface McpSdk {
  Server: new (
    info: { name: string; version: string },
    opts: { capabilities: { tools: Record<string, unknown> } },
  ) => McpServerHandle;
  StreamableHTTPServerTransport: new (opts?: McpTransportOptions) => McpTransport;
  types: McpSdkTypes;
}

let sdkPromise: McpSdk | undefined;

/**
 * Loads and caches the three SDK modules via `require` (resolves to the CJS
 * build). Requires a `createRequire` scoped to this app so the `exports`-map
 * subpaths resolve regardless of where the process was launched from.
 */
export function loadSdk(): McpSdk {
  if (!sdkPromise) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const requireFromApp = require('node:module').createRequire as (
      filename: string,
    ) => NodeJS.Require;
    const req = requireFromApp(__filename);

    sdkPromise = {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      Server: req('@modelcontextprotocol/sdk/server/index.js').Server as McpSdk['Server'],
      StreamableHTTPServerTransport: req(
        '@modelcontextprotocol/sdk/server/streamableHttp.js',
      ).StreamableHTTPServerTransport as McpSdk['StreamableHTTPServerTransport'],
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      types: req('@modelcontextprotocol/sdk/types.js') as McpSdkTypes,
    };
  }
  return sdkPromise;
}
