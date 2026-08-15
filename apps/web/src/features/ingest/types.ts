/**
 * Local copy of the FROZEN `POST /api/ingest` + `GET /api/ingest/:jobId`
 * contract (Phase 6 / Unit C). Do NOT import these from the backend package
 * — this file is the web app's own pinned copy so the UI can be built and
 * typechecked independently of the API unit, which ships in a later wave.
 */

/** Ordered phases the backend reports while ingesting a repo. `"queued"` and
 * `"failed"` are terminal/pre-work states, not steps in the visible stepper. */
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

/** Rolling counts surfaced as phases complete work. All optional — only
 * populated once the relevant phase has produced numbers. */
export interface IngestCounts {
  files?: number;
  symbols?: number;
  commits?: number;
  nodes?: number;
  edges?: number;
}

/** Why `POST /api/ingest` rejected a URL outright (400). */
export type RejectionReason =
  | "invalid_url"
  | "not_found"
  | "too_large"
  | "unsupported_language"
  | "too_many_files";

/** `POST /api/ingest` 202 body — accepted and enqueued. */
export interface IngestAcceptedResponse {
  jobId: string;
}

/** `POST /api/ingest` 200 body — already ingested, skip straight to the repo. */
export interface IngestCachedResponse {
  repoId: string;
  cached: true;
}

/** `POST /api/ingest` 400 body — rejected immediately (a designed dead-end). */
export interface IngestRejectedResponse {
  reason: RejectionReason;
  message: string;
}

export type IngestJobStatus = "queued" | "active" | "completed" | "failed";

/** `GET /api/ingest/:jobId` 200 body. */
export interface IngestJobStatusResponse {
  jobId: string;
  status: IngestJobStatus;
  phase: IngestPhase;
  counts?: IngestCounts;
  /** Present when `status === "completed"`. */
  repoId?: string;
  /** Present when `status === "failed"`. */
  error?: {
    reason?: RejectionReason;
    message: string;
  };
}
