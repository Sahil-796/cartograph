/**
 * The FROZEN engine contract. A separate API unit imports these shapes —
 * do not rename fields. See `index.ts` for the re-exported public surface.
 */

/** Ordered lifecycle of an ingest, as reported to `onProgress`. */
export type IngestPhase =
  | "queued"
  | "precheck"
  | "cloning"
  | "parsing"
  | "linking"
  | "history"
  | "writing"
  | "ready"
  | "failed";

/** Running tallies, filled in progressively as phases complete. */
export interface IngestCounts {
  files?: number;
  symbols?: number;
  commits?: number;
  nodes?: number;
  edges?: number;
}

/** One progress event. `message` is optional human copy for the UI. */
export interface IngestProgress {
  phase: IngestPhase;
  counts?: IngestCounts;
  message?: string;
}

/** Result of the fast, clone-free gate. */
export interface PrecheckResult {
  owner: string;
  repo: string;
  repoId: string;
  sizeKb: number;
  language: string | null;
  alreadyIngested: boolean;
}

/** Result of a full pipeline run. */
export interface IngestResult {
  repoId: string;
  repoName: string;
  nodes: number;
  edges: number;
  /** True when served from the DB without cloning/parsing. */
  cached: boolean;
}
