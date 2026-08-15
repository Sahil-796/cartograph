/**
 * The orchestrator: precheck → clone → extract → load → evict, emitting a
 * progress event at every phase transition. This is the whole engine; the
 * separate API/queue unit calls `runIngest` and forwards `onProgress` to a
 * websocket/SSE stream.
 *
 * No HTTP and no BullMQ live here. The one hard invariant is that the temp
 * clone directory is removed in a `finally`, on success AND on failure.
 *
 * `@cartograph/graph` is imported *dynamically*, inside the default step
 * implementations, for the same reason the CLI does it: importing it
 * eagerly pulls in `@cartograph/config`'s fail-fast env validation, which
 * would make this module impossible to unit-test (and impossible to import
 * at all without a full DB env). `@cartograph/extract` is pure and safe to
 * import statically.
 */
import { walkRepo, extractRepo } from "@cartograph/extract";
import type { GraphPayload } from "@cartograph/extract";
import type { LoadResult } from "@cartograph/graph";
import { IngestRejected } from "./errors.js";
import { parseGitHubUrl } from "./slug.js";
import { precheckRepo } from "./precheck.js";
import { makeCloneDir, cloneRepo, removeDir } from "./clone.js";
import { nodeCountFor } from "./db.js";
import type { IngestProgress, IngestResult, PrecheckResult } from "./types.js";

/** Source-file cap enforced after clone, before the heavy ts-morph parse. */
export const SOURCE_FILE_LIMIT = 1_500;

/**
 * Node budget across the whole DB, read from `INGEST_NODE_BUDGET`.
 *
 * Default 200,000. Rationale: the plan's ceiling is ~1 GB of disk for the
 * graph. Measured against CognoDB the mixed node/edge footprint of a
 * mid-size TS repo lands in the low-single-digit KB per node once indexes
 * are included, so ~200k nodes is a conservative proxy for that 1 GB
 * ceiling — comfortably above the three pinned seed repos (which are never
 * eviction candidates) while still triggering eviction of the oldest
 * *unpinned* repo before disk pressure becomes real. Operators tune it via
 * env without a code change.
 */
export function nodeBudget(): number {
  const raw = process.env.INGEST_NODE_BUDGET;
  if (raw !== undefined && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return 200_000;
}

/**
 * Injectable steps. The public `runIngest(url, onProgress)` matches the
 * frozen contract; this optional third argument exists only so the pure
 * unit tests can drive the orchestration (and assert temp-dir cleanup)
 * without a real clone, parse, DB, or network. Every field defaults to the
 * real implementation.
 */
export interface IngestDeps {
  precheck?: (url: string) => Promise<PrecheckResult>;
  makeCloneDir?: () => Promise<string>;
  cloneRepo?: (cloneUrl: string, destDir: string) => Promise<void>;
  removeDir?: (dir: string) => Promise<void>;
  countSourceFiles?: (dir: string) => number;
  extract?: (dir: string, opts: { repoId: string; repoName: string }) => Promise<GraphPayload>;
  load?: (payload: GraphPayload, opts: { pinned: boolean; url: string }) => Promise<LoadResult>;
  evict?: (budget: number) => Promise<unknown>;
  nodeCountFor?: (repoId: string) => Promise<number | null>;
  budget?: number;
}

/** Default load step — dynamic import keeps config validation lazy. */
async function defaultLoad(
  payload: GraphPayload,
  opts: { pinned: boolean; url: string },
): Promise<LoadResult> {
  const { loadPayload } = await import("@cartograph/graph");
  return loadPayload(payload, opts);
}

/** Default evict step — enforce the node budget after a successful write. */
async function defaultEvict(budget: number): Promise<unknown> {
  const { evictOldestUnpinned } = await import("@cartograph/graph");
  return evictOldestUnpinned({ budget });
}

function pluralFiles(n: number): string {
  return `${n.toLocaleString("en-US")} source file${n === 1 ? "" : "s"}`;
}

/**
 * Full ingest pipeline for a public GitHub repo URL.
 *
 * Emits, in order: `precheck` → (`ready` if cached) OR
 * `cloning` → `parsing` → `linking` → `history` → `writing` → `ready`.
 * Phase boundaries around the single `extractRepo` call are approximate by
 * design — they drive a progress UI, not a profiler.
 *
 * Throws {@link IngestRejected} for any guardrail failure (with a
 * human-readable `detail`) or a plain `Error` for anything unexpected. On
 * failure it emits a `failed` event before throwing. The temp clone dir is
 * always removed.
 */
export async function runIngest(
  url: string,
  onProgress: (p: IngestProgress) => void,
  deps: IngestDeps = {},
): Promise<IngestResult> {
  const precheck = deps.precheck ?? ((u: string) => precheckRepo(u));
  const mkDir = deps.makeCloneDir ?? makeCloneDir;
  const clone = deps.cloneRepo ?? cloneRepo;
  const rmDir = deps.removeDir ?? removeDir;
  const countFiles = deps.countSourceFiles ?? ((dir: string) => walkRepo(dir).length);
  const extract = deps.extract ?? ((dir, opts) => extractRepo(dir, opts));
  const load = deps.load ?? defaultLoad;
  const evict = deps.evict ?? defaultEvict;
  const countNodes = deps.nodeCountFor ?? nodeCountFor;
  const budget = deps.budget ?? nodeBudget();

  try {
    // 1. Precheck (URL parse + GitHub metadata + guardrails + cache check).
    onProgress({ phase: "precheck", message: "Checking the repo…" });
    const pre = await precheck(url);
    const repoName = `${pre.owner}/${pre.repo}`;

    // 2. Already ingested → serve from cache, no clone, no parse.
    if (pre.alreadyIngested) {
      const nodes = (await countNodes(pre.repoId)) ?? 0;
      onProgress({
        phase: "ready",
        counts: { nodes },
        message: "Already in the graph — served from cache.",
      });
      // Edge count isn't recoverable from a single node-count query and a
      // cache hit does no work to produce one; nodes reflects the live DB.
      return { repoId: pre.repoId, repoName, nodes, edges: 0, cached: true };
    }

    // The clone URL is canonical from the parse; precheck already proved
    // the URL is a valid github.com repo, so this never returns null here.
    const parsed = parseGitHubUrl(url);
    const cloneUrl = parsed ? parsed.cloneUrl : url;

    const dir = await mkDir();
    try {
      // 3. Clone (shallow, blobless).
      onProgress({ phase: "cloning", message: "Cloning the repo…" });
      await clone(cloneUrl, dir);

      // 4. Source-file cap — cheap walk before the expensive parse.
      const fileCount = countFiles(dir);
      if (fileCount > SOURCE_FILE_LIMIT) {
        throw new IngestRejected(
          "too_many_files",
          `This repo has ${pluralFiles(fileCount)} — the demo caps out at ${SOURCE_FILE_LIMIT.toLocaleString("en-US")}.`,
        );
      }

      // 5. Extract (parse + link + history in one call). Phase boundaries
      //    are approximate; counts fill in as we learn them.
      onProgress({ phase: "parsing", counts: { files: fileCount }, message: "Parsing source…" });
      const payload = await extract(dir, { repoId: pre.repoId, repoName: pre.repo });

      onProgress({
        phase: "linking",
        counts: { files: payload.files.length, symbols: payload.symbols.length },
        message: "Resolving symbols and calls…",
      });
      onProgress({
        phase: "history",
        counts: {
          files: payload.files.length,
          symbols: payload.symbols.length,
          commits: payload.commits.length,
        },
        message: "Reading git history…",
      });

      // 6. Write to CognoDB.
      onProgress({
        phase: "writing",
        counts: {
          files: payload.files.length,
          symbols: payload.symbols.length,
          commits: payload.commits.length,
        },
        message: "Writing the graph…",
      });
      const result = await load(payload, { pinned: false, url: cloneUrl });

      // 7. Enforce the node budget — evict oldest unpinned repo(s) if over.
      await evict(budget);

      onProgress({
        phase: "ready",
        counts: {
          files: payload.files.length,
          symbols: payload.symbols.length,
          commits: payload.commits.length,
          nodes: result.nodes.total,
          edges: result.edges.total,
        },
        message: "Done.",
      });

      return {
        repoId: pre.repoId,
        repoName,
        nodes: result.nodes.total,
        edges: result.edges.total,
        cached: false,
      };
    } finally {
      // The one hard invariant: never leak the temp clone dir.
      await rmDir(dir);
    }
  } catch (err) {
    const message = err instanceof IngestRejected ? err.detail : (err as Error).message;
    onProgress({ phase: "failed", message });
    throw err;
  }
}
