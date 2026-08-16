import './env.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * Integration test for the embedded MCP surface at `/api/mcp`.
 *
 * Same "spawn the real `dist/main.js`" rationale as `query.e2e.test.ts`:
 * `mcp-graph-loader.ts` crosses the ESM/CJS boundary with
 * `new Function(...)` dynamic imports, which vite-node's vm-based module
 * transform can't satisfy in-process. The built server sidesteps that, and
 * exercises the full stack — Nest controller → `StreamableHTTPServerTransport`
 * → SDK `Server` → the query registry — exactly as a real MCP client would.
 *
 * Talks to the server through the official MCP SDK's
 * `StreamableHTTPClientTransport`, i.e. a genuine MCP handshake (initialize →
 * tools/list → tools/call) over HTTP, not hand-rolled JSON-RPC frames.
 *
 * DB-required assertions self-skip when the shared live CognoDB is
 * unreachable (CI has no credentials — see the dummy env in the workflow),
 * the same convention the query e2e test uses.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');
const port = 3912;
const base = `http://localhost:${port}`;

let server: ChildProcess;
let client: Client;
let transport: StreamableHTTPClientTransport;

async function waitForServer(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      // not up yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('api server did not become healthy in time');
}

beforeAll(async () => {
  server = spawn('node', ['dist/main.js'], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: 'pipe',
  });
  await waitForServer();

  transport = new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`));
  client = new Client({ name: 'cartograph-e2e', version: '0.0.0' });
  await client.connect(transport);
}, 20_000);

afterAll(async () => {
  await client?.close();
  server?.kill();
});

describe('embedded MCP server (/api/mcp)', () => {
  it('lists the full query registry as tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual(
      [
        'search',
        'neighbors',
        'path',
        'who_touched',
        'bus_factor',
        'co_changed',
        'hidden_coupling',
        'cycles',
        'entrypoints',
        'file_graph',
        'file_metrics',
        'file_commits',
        'tests_for_file',
      ].sort(),
    );
  });

  it('returns an isError result for an unknown tool, listing valid names', async () => {
    const result = await client.callTool({ name: 'not_a_tool' });
    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[]).map((c) => c.text).join('\n');
    expect(text).toContain('unknown tool "not_a_tool"');
    expect(text).toContain('hidden_coupling');
  });

  it('returns an isError result when a required param is missing (before touching the DB)', async () => {
    const result = await client.callTool({ name: 'who_touched', arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[]).map((c) => c.text).join('\n');
    expect(text).toContain('invalid parameters for "who_touched"');
  });

  it('returns a successful (possibly empty) result for a valid query', async (ctx) => {
    const result = await client.callTool({
      name: 'hidden_coupling',
      arguments: { repoId: '__nonexistent__' },
    });

    // With no reachable CognoDB the query fails as an isError result; with a
    // live DB it succeeds against a nonexistent repoId (empty rows). Skip only
    // when the DB is genuinely unreachable, so CI stays green.
    const text = (result.content as { text: string }[]).map((c) => c.text).join('\n');
    if (result.isError && /failed:.*(ECONNREFUSED|Connection refused|EHOSTUNREACH|ETIMEDOUT)/i.test(text)) {
      ctx.skip();
      return;
    }
    expect(result.isError).not.toBe(true);
    const body = JSON.parse(text) as { name: string; rows: unknown[] };
    expect(body.name).toBe('hidden_coupling');
    expect(Array.isArray(body.rows)).toBe(true);
  });
});
