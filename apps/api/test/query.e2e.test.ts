import './env.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Integration test for `POST /api/query/:name`.
 *
 * Why this spawns the real built server instead of driving
 * `@nestjs/testing`'s in-process `Test.createTestingModule` (the more
 * common Nest pattern): `graph-loader.ts` reaches across the ESM/CJS
 * boundary with `new Function("specifier", "return import(specifier)")`
 * — the standard trick to stop TypeScript's CommonJS emit from
 * downleveling `import()` into a `require()` that can't load an
 * ESM-only package (see that file's comment for the full story). That
 * trick needs a real V8 module-instantiation context to resolve the
 * dynamic import against. Vitest runs test (and app) code through
 * vite-node's own `vm`-based module transform, which does not wire up
 * `importModuleDynamically` for code executed via `new Function` —
 * calling `loadGraph()` inside an in-process `@nestjs/testing` app
 * throws `TypeError: A dynamic import callback was not specified.`
 * every time, regardless of how the controller/module are structured.
 * That's a limitation of vite-node's sandbox, not of the app.
 *
 * Spawning `node dist/main.js` as a real child process (built by `nest
 * build`, exactly what `start`/`start:dev` run) sidesteps vite-node's
 * vm entirely — the dynamic import runs in an ordinary Node process,
 * exactly as it will in production — and the test still runs
 * automatically under `pnpm test`, no manual curl step required.
 *
 * Uses a nonexistent `repoId` throughout, so the shared live CognoDB
 * this test's `hidden_coupling` calls hit is only ever read from (an
 * empty match), never written to.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');
const port = 3911;
const base = `http://localhost:${port}`;

let server: ChildProcess;

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
}, 20_000);

afterAll(() => {
  server?.kill();
});

describe('POST /api/query/:name', () => {
  it('200s with an empty rows array for a valid query against a nonexistent repoId', async () => {
    const res = await fetch(`${base}/api/query/hidden_coupling`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoId: '__nonexistent__' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'hidden_coupling', rows: [] });
  });

  it('400s with zod issues when the body fails the query schema (missing repoId)', async () => {
    const res = await fetch(`${base}/api/query/hidden_coupling`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe('invalid query parameters');
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it('400s with zod issues when a field has the wrong type (minCount as a string)', async () => {
    const res = await fetch(`${base}/api/query/hidden_coupling`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoId: '__nonexistent__', minCount: 'abc' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.issues.some((issue: { path: string[] }) => issue.path.includes('minCount'))).toBe(true);
  });

  it('404s for an unknown query name, listing valid names', async () => {
    const res = await fetch(`${base}/api/query/not_a_query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toContain('unknown query "not_a_query"');
    expect(body.message).toContain('hidden_coupling');
  });
});
