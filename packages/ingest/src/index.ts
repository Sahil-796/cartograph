/**
 * `@cartograph/ingest` — the pure ingestion engine.
 *
 * Turns a public GitHub repo URL into a loaded graph in CognoDB, guarded
 * by the guardrail table (size / language / file-count / already-ingested
 * / node-budget) and reporting progress at every phase. No HTTP, no queue,
 * no BullMQ — a separate API unit imports this surface and drives it.
 *
 * repoId slug scheme: `owner-repo`, lowercased, with every run of
 * non-alphanumeric characters collapsed to a single `-`. e.g.
 * `honojs/hono` → `honojs-hono`. It never collides with the bare-name seed
 * ids (`hono`, `drizzle-orm`, `papermark`) because it always carries the
 * owner. (More entrypoints are re-exported here as later commits add them.)
 */

// The frozen contract types.
export type {
  IngestPhase,
  IngestCounts,
  IngestProgress,
  PrecheckResult,
  IngestResult,
} from "./types.js";
export type { RejectionReason } from "./errors.js";
export { IngestRejected } from "./errors.js";

// The two public entrypoints.
export { precheckRepo } from "./precheck.js";
export { runIngest } from "./pipeline.js";

// Building blocks, exported for reuse and targeted testing.
export { parseGitHubUrl, deriveRepoId } from "./slug.js";
export type { ParsedGitHubUrl } from "./slug.js";
export { SIZE_LIMIT_KB, SUPPORTED_LANGUAGES } from "./precheck.js";
export type { PrecheckDeps } from "./precheck.js";
export { makeCloneDir, cloneRepo, removeDir, CLONE_DEPTH } from "./clone.js";
export { SOURCE_FILE_LIMIT, nodeBudget } from "./pipeline.js";
export type { IngestDeps } from "./pipeline.js";

// DB read helpers (cache check).
export { repoExists, nodeCountFor } from "./db.js";
