import { describe, expect, it, vi } from "vitest";
import { runIngest, SOURCE_FILE_LIMIT, nodeBudget } from "../src/pipeline.js";
import { IngestRejected } from "../src/errors.js";
import type { IngestDeps } from "../src/pipeline.js";
import type { IngestProgress, PrecheckResult } from "../src/types.js";

/** A minimal GraphPayload — only the fields the pipeline reads matter. */
function fakePayload(files = 3, symbols = 5, commits = 7) {
  return {
    repo: { id: "owner-repo", name: "repo" },
    files: Array.from({ length: files }),
    symbols: Array.from({ length: symbols }),
    entrypoints: [],
    authors: [],
    commits: Array.from({ length: commits }),
    imports: [],
    calls: [],
    defines: [],
    handledBy: [],
    touched: [],
    coChanged: [],
    stats: { callsResolved: 0, callsInScope: 0, callsObserved: 0, callResolutionRate: 1 },
  } as never;
}

function fakeLoadResult(nodes = 42, edges = 99) {
  return {
    nodes: { repo: 1, file: 0, symbol: 0, entrypoint: 0, author: 0, commit: 0, total: nodes },
    edges: {
      imports: 0, defines: 0, calls: 0, handledBy: 0, changed: 0, authored: 0, coChanged: 0,
      total: edges,
    },
  } as never;
}

function precheckResult(over: Partial<PrecheckResult> = {}): PrecheckResult {
  return {
    owner: "owner",
    repo: "repo",
    repoId: "owner-repo",
    sizeKb: 100,
    language: "TypeScript",
    alreadyIngested: false,
    ...over,
  };
}

/** Deps wired to spies; the temp dir is a fixed sentinel path. */
function makeDeps(over: Partial<IngestDeps> = {}) {
  const removeDir = vi.fn(async () => {});
  const deps: IngestDeps = {
    precheck: vi.fn(async () => precheckResult()),
    makeCloneDir: vi.fn(async () => "/tmp/fake-clone-dir"),
    cloneRepo: vi.fn(async () => {}),
    removeDir,
    countSourceFiles: vi.fn(() => 10),
    extract: vi.fn(async () => fakePayload()),
    load: vi.fn(async () => fakeLoadResult()),
    evict: vi.fn(async () => ({})),
    nodeCountFor: vi.fn(async () => 1234),
    budget: 500_000,
    ...over,
  };
  return { deps, removeDir };
}

describe("runIngest", () => {
  it("runs the full pipeline and emits phases in order", async () => {
    const { deps } = makeDeps();
    const events: IngestProgress[] = [];
    const result = await runIngest("https://github.com/owner/repo", (p) => events.push(p), deps);

    expect(events.map((e) => e.phase)).toEqual([
      "precheck",
      "cloning",
      "parsing",
      "linking",
      "history",
      "writing",
      "ready",
    ]);
    expect(result).toEqual({
      repoId: "owner-repo",
      repoName: "owner/repo",
      nodes: 42,
      edges: 99,
      cached: false,
    });
  });

  it("cleans up the temp dir on success", async () => {
    const { deps, removeDir } = makeDeps();
    await runIngest("https://github.com/owner/repo", () => {}, deps);
    expect(removeDir).toHaveBeenCalledWith("/tmp/fake-clone-dir");
  });

  it("cleans up the temp dir even when extraction throws", async () => {
    const { deps, removeDir } = makeDeps({
      extract: vi.fn(async () => {
        throw new Error("ts-morph blew up");
      }),
    });
    const events: IngestProgress[] = [];
    await expect(
      runIngest("https://github.com/owner/repo", (p) => events.push(p), deps),
    ).rejects.toThrow("ts-morph blew up");

    expect(removeDir).toHaveBeenCalledWith("/tmp/fake-clone-dir");
    expect(events.at(-1)?.phase).toBe("failed");
  });

  it("cleans up the temp dir when the clone itself fails", async () => {
    const { deps, removeDir } = makeDeps({
      cloneRepo: vi.fn(async () => {
        throw new Error("git exploded");
      }),
    });
    await expect(runIngest("https://github.com/owner/repo", () => {}, deps)).rejects.toThrow(
      "git exploded",
    );
    expect(removeDir).toHaveBeenCalledWith("/tmp/fake-clone-dir");
  });

  it("rejects too_many_files after clone, before parsing, and still cleans up", async () => {
    const extract = vi.fn(async () => fakePayload());
    const { deps, removeDir } = makeDeps({
      countSourceFiles: vi.fn(() => SOURCE_FILE_LIMIT + 1),
      extract,
    });
    const events: IngestProgress[] = [];
    const err = await runIngest("https://github.com/owner/repo", (p) => events.push(p), deps).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(IngestRejected);
    expect(err.reason).toBe("too_many_files");
    expect(extract).not.toHaveBeenCalled();
    expect(removeDir).toHaveBeenCalledWith("/tmp/fake-clone-dir");
    expect(events.some((e) => e.phase === "parsing")).toBe(false);
  });

  it("serves an already-ingested repo from cache without cloning", async () => {
    const makeCloneDir = vi.fn(async () => "/tmp/fake-clone-dir");
    const { deps } = makeDeps({
      precheck: vi.fn(async () => precheckResult({ alreadyIngested: true })),
      makeCloneDir,
      nodeCountFor: vi.fn(async () => 555),
    });
    const events: IngestProgress[] = [];
    const result = await runIngest("https://github.com/owner/repo", (p) => events.push(p), deps);

    expect(result).toEqual({
      repoId: "owner-repo",
      repoName: "owner/repo",
      nodes: 555,
      edges: 0,
      cached: true,
    });
    expect(makeCloneDir).not.toHaveBeenCalled();
    expect(events.map((e) => e.phase)).toEqual(["precheck", "ready"]);
  });

  it("passes the node budget through to eviction", async () => {
    const evict = vi.fn(async () => ({}));
    const { deps } = makeDeps({ evict, budget: 12_345 });
    await runIngest("https://github.com/owner/repo", () => {}, deps);
    expect(evict).toHaveBeenCalledWith(12_345);
  });
});

describe("nodeBudget", () => {
  const KEY = "INGEST_NODE_BUDGET";

  it("defaults to 200_000 when unset", () => {
    const prev = process.env[KEY];
    delete process.env[KEY];
    expect(nodeBudget()).toBe(200_000);
    if (prev !== undefined) process.env[KEY] = prev;
  });

  it("reads a positive integer from the env", () => {
    const prev = process.env[KEY];
    process.env[KEY] = "75000";
    expect(nodeBudget()).toBe(75_000);
    if (prev === undefined) delete process.env[KEY];
    else process.env[KEY] = prev;
  });

  it("falls back to the default on garbage input", () => {
    const prev = process.env[KEY];
    process.env[KEY] = "not-a-number";
    expect(nodeBudget()).toBe(200_000);
    if (prev === undefined) delete process.env[KEY];
    else process.env[KEY] = prev;
  });
});
