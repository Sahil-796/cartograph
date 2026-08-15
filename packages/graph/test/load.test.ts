import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphPayload } from "@cartograph/extract";

/**
 * `load.ts` talks to CognoDB exclusively through `withSession` (see
 * `driver.ts`). Mocking that module lets us assert on exactly what
 * Cypher/params `loadPayload` sends, with a fake `session.run` spy,
 * without ever touching a real database.
 */
const runMock = vi.fn(async (_cypher: string, _params?: unknown) => ({ records: [] }));
const fakeSession = { run: runMock };

vi.mock("../src/driver.js", () => ({
  withSession: async (fn: (session: typeof fakeSession) => Promise<unknown>) => fn(fakeSession),
}));

const { loadPayload } = await import("../src/load.js");

const REPO_ID = "repo-1";

function basePayload(overrides: Partial<GraphPayload> = {}): GraphPayload {
  return {
    repo: { id: REPO_ID, name: "Test Repo" },
    files: [],
    symbols: [],
    entrypoints: [],
    authors: [],
    commits: [],
    imports: [],
    calls: [],
    defines: [],
    handledBy: [],
    touched: [],
    coChanged: [],
    stats: { callsResolved: 0, callsInScope: 0, callsObserved: 0, callResolutionRate: 1 },
    ...overrides,
  };
}

beforeEach(() => {
  runMock.mockClear();
});

describe("loadPayload — fixed load order", () => {
  it("loads Repo, then File, Symbol, Entrypoint, Author, Commit, then relationships", async () => {
    const payload = basePayload({
      files: [{ repoId: REPO_ID, path: "src/a.ts", ext: ".ts", loc: 10, isTest: false, isGenerated: false }],
      symbols: [
        { repoId: REPO_ID, id: "src/a.ts#foo", name: "foo", kind: "function", path: "src/a.ts", line: 1, exported: true },
      ],
      entrypoints: [{ repoId: REPO_ID, id: "GET /foo", kind: "route", method: "GET", route: "/foo", path: "src/a.ts" }],
      authors: [{ repoId: REPO_ID, email: "a@x.com", name: "A", isBot: false }],
      commits: [{ repoId: REPO_ID, sha: "sha1", authorEmail: "a@x.com", timestamp: "2024-01-01T00:00:00.000Z", message: "m" }],
      imports: [{ repoId: REPO_ID, fromPath: "src/a.ts", toPath: "src/a.ts" }],
      defines: [{ repoId: REPO_ID, filePath: "src/a.ts", symbolId: "src/a.ts#foo" }],
      calls: [{ repoId: REPO_ID, fromSymbolId: "src/a.ts#foo", toSymbolId: "src/a.ts#foo" }],
      handledBy: [{ repoId: REPO_ID, entrypointId: "GET /foo", path: "src/a.ts", symbolId: "src/a.ts#foo" }],
      touched: [{ repoId: REPO_ID, sha: "sha1", path: "src/a.ts", additions: 1, deletions: 0 }],
      coChanged: [],
    });

    await loadPayload(payload);

    const cyphers = runMock.mock.calls.map((call) => call[0] as string);
    const idxOf = (needle: string) => cyphers.findIndex((c) => c.includes(needle));

    const repoIdx = idxOf("MERGE (r:Repo");
    const fileIdx = idxOf("MERGE (f:File");
    const symbolIdx = idxOf("MERGE (s:Symbol");
    const entrypointIdx = idxOf("MERGE (e:Entrypoint");
    const authorIdx = idxOf("MERGE (a:Author");
    const commitIdx = idxOf("MERGE (c:Commit");
    const importsIdx = idxOf("[rel:IMPORTS]");
    const definesIdx = idxOf("[rel:DEFINES]");
    const callsIdx = idxOf("[rel:CALLS]");
    const handledByIdx = idxOf("[rel:HANDLED_BY]");
    const changedIdx = idxOf("[rel:CHANGED]");
    const authoredIdx = idxOf("[rel:AUTHORED]");

    for (const idx of [repoIdx, fileIdx, symbolIdx, entrypointIdx, authorIdx, commitIdx]) {
      expect(idx).toBeGreaterThanOrEqual(0);
    }

    expect(repoIdx).toBeLessThan(fileIdx);
    expect(fileIdx).toBeLessThan(symbolIdx);
    expect(symbolIdx).toBeLessThan(entrypointIdx);
    expect(entrypointIdx).toBeLessThan(authorIdx);
    expect(authorIdx).toBeLessThan(commitIdx);

    // Every relationship batch runs after every node batch.
    for (const relIdx of [importsIdx, definesIdx, callsIdx, handledByIdx, changedIdx, authoredIdx]) {
      expect(relIdx).toBeGreaterThan(commitIdx);
    }
  });
});

describe("loadPayload — batching", () => {
  it("splits a batch larger than batchSize into multiple session.run calls", async () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      repoId: REPO_ID,
      path: `src/f${i}.ts`,
      ext: ".ts",
      loc: 1,
      isTest: false,
      isGenerated: false,
    }));
    const payload = basePayload({ files });

    await loadPayload(payload, { batchSize: 2 });

    const fileCalls = runMock.mock.calls.filter((call) => (call[0] as string).includes("MERGE (f:File"));
    // 5 rows at batchSize 2 -> 3 round trips (2, 2, 1), never 5 (per-row).
    expect(fileCalls).toHaveLength(3);
    const batchSizes = fileCalls.map((call) => (call[1] as { batch: unknown[] }).batch.length);
    expect(batchSizes).toEqual([2, 2, 1]);
  });

  it("issues no session.run call for an empty node/edge list", async () => {
    const payload = basePayload();
    await loadPayload(payload);

    const fileCalls = runMock.mock.calls.filter((call) => (call[0] as string).includes("MERGE (f:File"));
    expect(fileCalls).toHaveLength(0);
  });
});

describe("loadPayload — MERGE idempotency (assert by construction)", () => {
  it("uses MERGE, never CREATE, for every node and relationship statement", async () => {
    const payload = basePayload({
      files: [{ repoId: REPO_ID, path: "src/a.ts", ext: ".ts", loc: 1, isTest: false, isGenerated: false }],
      symbols: [{ repoId: REPO_ID, id: "src/a.ts#foo", name: "foo", kind: "function", path: "src/a.ts", line: 1, exported: true }],
      entrypoints: [{ repoId: REPO_ID, id: "GET /foo", kind: "route", method: "GET", route: "/foo", path: "src/a.ts" }],
      authors: [{ repoId: REPO_ID, email: "a@x.com", name: "A", isBot: false }],
      commits: [{ repoId: REPO_ID, sha: "sha1", authorEmail: "a@x.com", timestamp: "2024-01-01T00:00:00.000Z", message: "m" }],
      imports: [{ repoId: REPO_ID, fromPath: "src/a.ts", toPath: "src/a.ts" }],
      defines: [{ repoId: REPO_ID, filePath: "src/a.ts", symbolId: "src/a.ts#foo" }],
      calls: [{ repoId: REPO_ID, fromSymbolId: "src/a.ts#foo", toSymbolId: "src/a.ts#foo" }],
      handledBy: [{ repoId: REPO_ID, entrypointId: "GET /foo", path: "src/a.ts", symbolId: "src/a.ts#foo" }],
      touched: [{ repoId: REPO_ID, sha: "sha1", path: "src/a.ts", additions: 1, deletions: 0 }],
      coChanged: [{ repoId: REPO_ID, pathA: "src/a.ts", pathB: "src/a.ts", count: 3, strength: 1 }],
    });

    await loadPayload(payload);

    expect(runMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of runMock.mock.calls) {
      const cypher = call[0] as string;
      expect(cypher).toContain("MERGE");
      expect(cypher).not.toMatch(/\bCREATE\b/);
    }
  });
});

describe("loadPayload — derivations", () => {
  it("derives File.dir from File.path", async () => {
    const payload = basePayload({
      files: [{ repoId: REPO_ID, path: "src/foo/bar.ts", ext: ".ts", loc: 1, isTest: false, isGenerated: false }],
    });

    await loadPayload(payload);

    const fileCall = runMock.mock.calls.find((call) => (call[0] as string).includes("MERGE (f:File"));
    const batch = (fileCall?.[1] as { batch: Array<{ dir: string }> }).batch;
    expect(batch[0]?.dir).toBe("src/foo");
  });

  it("aggregates duplicate CALLS pairs into a single edge with a count", async () => {
    const payload = basePayload({
      calls: [
        { repoId: REPO_ID, fromSymbolId: "a#f", toSymbolId: "b#g" },
        { repoId: REPO_ID, fromSymbolId: "a#f", toSymbolId: "b#g" },
        { repoId: REPO_ID, fromSymbolId: "a#f", toSymbolId: "c#h" },
      ],
    });

    await loadPayload(payload);

    const callsCall = runMock.mock.calls.find((call) => (call[0] as string).includes("[rel:CALLS]"));
    const batch = (callsCall?.[1] as { batch: Array<{ fromSymbolId: string; toSymbolId: string; count: number }> }).batch;
    expect(batch).toHaveLength(2);
    const bg = batch.find((r) => r.toSymbolId === "b#g");
    expect(bg?.count).toBe(2);
    const ch = batch.find((r) => r.toSymbolId === "c#h");
    expect(ch?.count).toBe(1);
  });

  it("computes Commit.fileCount from the number of touched edges for that sha", async () => {
    const payload = basePayload({
      commits: [{ repoId: REPO_ID, sha: "sha1", authorEmail: "a@x.com", timestamp: "2024-01-01T00:00:00.000Z", message: "m" }],
      touched: [
        { repoId: REPO_ID, sha: "sha1", path: "a.ts", additions: 1, deletions: 0 },
        { repoId: REPO_ID, sha: "sha1", path: "b.ts", additions: 1, deletions: 0 },
      ],
    });

    await loadPayload(payload);

    const commitCall = runMock.mock.calls.find((call) => (call[0] as string).includes("MERGE (c:Commit"));
    const batch = (commitCall?.[1] as { batch: Array<{ fileCount: number }> }).batch;
    expect(batch[0]?.fileCount).toBe(2);
  });

  it("stores Commit.committedAt as epoch seconds parsed from the ISO timestamp", async () => {
    const iso = "2024-01-01T00:00:00.000Z";
    const payload = basePayload({
      commits: [{ repoId: REPO_ID, sha: "sha1", authorEmail: "a@x.com", timestamp: iso, message: "m" }],
    });

    await loadPayload(payload);

    const commitCall = runMock.mock.calls.find((call) => (call[0] as string).includes("MERGE (c:Commit"));
    const batch = (commitCall?.[1] as { batch: Array<{ committedAt: number }> }).batch;
    expect(batch[0]?.committedAt).toBe(Math.floor(Date.parse(iso) / 1000));
  });

  it("derives AUTHORED edges by joining Commit.authorEmail to Author.email", async () => {
    const payload = basePayload({
      authors: [{ repoId: REPO_ID, email: "a@x.com", name: "A", isBot: false }],
      commits: [{ repoId: REPO_ID, sha: "sha1", authorEmail: "a@x.com", timestamp: "2024-01-01T00:00:00.000Z", message: "m" }],
    });

    await loadPayload(payload);

    const authoredCall = runMock.mock.calls.find((call) => (call[0] as string).includes("[rel:AUTHORED]"));
    const batch = (authoredCall?.[1] as { batch: Array<{ authorEmail: string; sha: string }> }).batch;
    expect(batch).toEqual([{ repoId: REPO_ID, authorEmail: "a@x.com", sha: "sha1" }]);
  });

  it("drops HANDLED_BY edges with no resolved symbolId", async () => {
    const payload = basePayload({
      entrypoints: [{ repoId: REPO_ID, id: "GET /foo", kind: "route", method: "GET", route: "/foo", path: "src/a.ts" }],
      handledBy: [{ repoId: REPO_ID, entrypointId: "GET /foo", path: "src/a.ts" }],
    });

    await loadPayload(payload);

    const handledByCall = runMock.mock.calls.find((call) => (call[0] as string).includes("[rel:HANDLED_BY]"));
    expect(handledByCall).toBeUndefined();
  });

  it("computes Repo.nodeCount as the sum of all node arrays plus the Repo node itself", async () => {
    const payload = basePayload({
      files: [{ repoId: REPO_ID, path: "a.ts", ext: ".ts", loc: 1, isTest: false, isGenerated: false }],
      symbols: [{ repoId: REPO_ID, id: "a.ts#f", name: "f", kind: "function", path: "a.ts", line: 1, exported: true }],
      authors: [{ repoId: REPO_ID, email: "a@x.com", name: "A", isBot: false }],
      commits: [{ repoId: REPO_ID, sha: "sha1", authorEmail: "a@x.com", timestamp: "2024-01-01T00:00:00.000Z", message: "m" }],
    });

    await loadPayload(payload);

    const repoCall = runMock.mock.calls.find((call) => (call[0] as string).includes("MERGE (r:Repo"));
    const batch = (repoCall?.[1] as { batch: Array<{ nodeCount: number }> }).batch;
    // 1 file + 1 symbol + 0 entrypoints + 1 author + 1 commit + 1 repo itself = 5
    expect(batch[0]?.nodeCount).toBe(5);
  });

  it("defaults pinned to false and stamps ingestedAt, honouring explicit opts", async () => {
    const payload = basePayload();

    await loadPayload(payload, { pinned: true, url: "https://example.com/repo.git", commitSha: "deadbeef" });

    const repoCall = runMock.mock.calls.find((call) => (call[0] as string).includes("MERGE (r:Repo"));
    const batch = (repoCall?.[1] as {
      batch: Array<{ pinned: boolean; url?: string; commitSha?: string; ingestedAt: string }>;
    }).batch;
    expect(batch[0]?.pinned).toBe(true);
    expect(batch[0]?.url).toBe("https://example.com/repo.git");
    expect(batch[0]?.commitSha).toBe("deadbeef");
    expect(typeof batch[0]?.ingestedAt).toBe("string");
  });
});

describe("loadPayload — return value", () => {
  it("returns per-label node and edge counts", async () => {
    const payload = basePayload({
      files: [{ repoId: REPO_ID, path: "a.ts", ext: ".ts", loc: 1, isTest: false, isGenerated: false }],
      symbols: [{ repoId: REPO_ID, id: "a.ts#f", name: "f", kind: "function", path: "a.ts", line: 1, exported: true }],
    });

    const result = await loadPayload(payload);

    expect(result.nodes.repo).toBe(1);
    expect(result.nodes.file).toBe(1);
    expect(result.nodes.symbol).toBe(1);
    expect(result.nodes.total).toBe(result.nodes.file + result.nodes.symbol + result.nodes.entrypoint + result.nodes.author + result.nodes.commit + 1);
  });
});
