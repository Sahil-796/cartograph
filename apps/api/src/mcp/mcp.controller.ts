/**
 * The HTTP front door onto the query registry: `POST /api/mcp` (and GET for
 * SSE streams) speaking MCP's Streamable HTTP transport. This is the "embedded
 * in the same backend server" pattern — the same Nest process that serves
 * `POST /api/query/:name` and `/api/chat` also speaks MCP, so one deployment
 * exposes all three doors to the same shared CognoDB.
 *
 * Sessions: MCP over Streamable HTTP is stateful. Each client session owns one
 * `StreamableHTTPServerTransport` + one connected `Server` (the SDK's
 * `Protocol.connect` throws if a server is already connected to a transport,
 * so a session gets its own server instance, not a shared one). Sessions are
 * keyed by the client-supplied `mcp-session-id` header and registered lazily
 * via `onsessioninitialized`; a request carrying an unknown session id gets a
 * 404 rather than silently starting a fresh session.
 *
 * Auth: when `MCP_API_KEY` is set in the environment, every request must carry
 * it in the `x-api-key` header (401 otherwise). Unset = open (local/dev).
 */

import { All, Controller, Req, Res, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { createMcpServer } from './mcp-server';
import { loadMcpDeps } from './mcp-graph-loader';
import { loadSdk, type McpServerHandle, type McpTransport } from './mcp-sdk';

interface McpSession {
  server: McpServerHandle;
  transport: McpTransport;
  ready: Promise<void>;
}

@Controller('api/mcp')
export class McpController {
  private readonly sessions = new Map<string, McpSession>();
  private readonly depsPromise = loadMcpDeps();

  @All()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    // Auth first — cheapest gate, before any session/transport work.
    const expected = process.env.MCP_API_KEY;
    if (expected && req.header('x-api-key') !== expected) {
      throw new UnauthorizedException('missing or invalid x-api-key');
    }

    const deps = await this.depsPromise;
    const sessionId = req.header('mcp-session-id');

    // A client-supplied session id we've never seen → 404 (stateful transport
    // semantics), rather than silently starting a new session under it.
    if (sessionId && !this.sessions.has(sessionId)) {
      res.status(404).end();
      return;
    }

    let session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session) {
      session = this.createSession(deps);
    }
    await session.ready;

    // Nest has already parsed the JSON body into `req.body`; pass it through
    // as the transport's `parsedBody` so it doesn't re-read the stream. GET
    // (SSE) requests have no body — `undefined` is what the transport expects.
    try {
      await session.transport.handleRequest(req as never, res as never, req.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) res.status(500).send(`mcp request failed: ${message}`);
    }
  }

  /**
   * Builds a fresh server+transport pair and registers it in the session map
   * once the transport has minted its session id. The session variable is
   * assigned after construction but the `onsessioninitialized` callback only
   * fires during `handleRequest` — by then `session` is bound.
   */
  private createSession(deps: Awaited<ReturnType<typeof loadMcpDeps>>): McpSession {
    const { StreamableHTTPServerTransport } = loadSdk();
    const server = createMcpServer(deps);
    const session: McpSession = {
      server,
      transport: undefined as unknown as McpTransport,
      ready: Promise.resolve(),
    };

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        session.transport = transport;
        this.sessions.set(id, session);
      },
      onsessionclosed: (id) => {
        this.sessions.delete(id);
      },
    });

    session.transport = transport;
    session.ready = server.connect(transport).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`mcp server connect failed: ${message}`);
    });
    return session;
  }
}
