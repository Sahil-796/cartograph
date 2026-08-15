/**
 * The FROZEN HTTP contract for the ingestion surface. The web UI is already
 * built against these shapes — do not rename fields.
 *
 * These mirror `@cartograph/ingest`'s engine contract but are declared locally
 * so this CommonJS app never has to statically `import` the ESM-only engine
 * (which is loaded dynamically at runtime; see `ingest-loader.ts`).
 */

/** Ordered lifecycle of an ingest, as reported by the engine + our two virtual states. */
export type IngestPhase =
  | 'queued'
  | 'precheck'
  | 'cloning'
  | 'parsing'
  | 'linking'
  | 'history'
  | 'writing'
  | 'ready'
  | 'failed';

/** Running tallies, filled in progressively as phases complete. */
export interface IngestCounts {
  files?: number;
  symbols?: number;
  commits?: number;
  nodes?: number;
  edges?: number;
}

/** Guardrail rejection reasons carried back to the client. */
export type RejectionReason =
  | 'invalid_url'
  | 'not_found'
  | 'too_large'
  | 'unsupported_language'
  | 'too_many_files';

/** Job status as reported by `GET /api/ingest/:jobId`. */
export type JobStatus = 'queued' | 'active' | 'completed' | 'failed';

/** Structured failure carried in the GET response when a job fails. */
export interface JobError {
  reason?: RejectionReason;
  message: string;
}

/** `GET /api/ingest/:jobId` → 200 body. */
export interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  phase: IngestPhase;
  counts?: IngestCounts;
  repoId?: string;
  error?: JobError;
}

/**
 * The shape stashed via `job.updateProgress`. `phase`/`counts` drive the GET's
 * live reporting; `error` is written just before an `IngestRejected` throw so
 * the GET can surface the structured reason (BullMQ's `failedReason` is only a
 * plain string).
 */
export interface IngestJobProgress {
  phase: IngestPhase;
  counts?: IngestCounts;
  message?: string;
  error?: JobError;
}
