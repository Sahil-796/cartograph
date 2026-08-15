/**
 * The pure, I/O-free core of the ingestion surface — mirrors the codebase
 * convention of a pure module (`loop.ts`) tested directly by its spec
 * (`loop.spec.ts`), with the Nest controller/service doing only the wiring.
 *
 * Two responsibilities:
 *  - `submitIngest`: the `POST /api/ingest` decision tree (reject / cached /
 *    enqueue / queue-unavailable), driven by injected deps.
 *  - `describeJob`: the `GET /api/ingest/:jobId` job-state → response mapping.
 */
import type {
  IngestCounts,
  IngestJobProgress,
  IngestPhase,
  JobError,
  JobStatus,
  JobStatusResponse,
  RejectionReason,
} from './ingest.types';

/** The precheck result shape we depend on (structural subset of the engine's). */
export interface PrecheckLike {
  repoId: string;
  alreadyIngested: boolean;
}

/** A guardrail rejection as seen at this boundary (structural, module-identity-free). */
export interface RejectionLike {
  reason: RejectionReason;
  message: string;
}

/** Injected I/O for `submitIngest`, so the decision tree stays pure + testable. */
export interface SubmitDeps {
  /** Fast, clone-free gate. Throws a rejection (see `asRejection`) on guardrail failure. */
  precheckRepo(url: string): Promise<PrecheckLike>;
  /** Narrows an unknown throw to a structured rejection, or `null` if it's an unexpected error. */
  asRejection(err: unknown): RejectionLike | null;
  /** Enqueues an ingest job, resolving to its jobId. Throws if the queue/Redis is unreachable. */
  enqueue(url: string): Promise<string>;
}

/** Discriminated outcome of a submit, mapped to HTTP status by the controller. */
export type SubmitResult =
  | { kind: 'rejected'; reason: RejectionReason; message: string } // → 400 { reason, message }
  | { kind: 'cached'; repoId: string } //                            → 200 { repoId, cached: true }
  | { kind: 'queued'; jobId: string } //                             → 202 { jobId }
  | { kind: 'unavailable'; message: string }; //                     → 503 { message }

/**
 * The `POST /api/ingest` decision tree. Precheck runs synchronously first so a
 * bad repo is rejected before the user waits on a queue; only a clean,
 * not-yet-ingested repo is enqueued.
 */
export async function submitIngest(deps: SubmitDeps, url: string): Promise<SubmitResult> {
  let precheck: PrecheckLike;
  try {
    precheck = await deps.precheckRepo(url);
  } catch (err) {
    const rejection = deps.asRejection(err);
    if (rejection) {
      return { kind: 'rejected', reason: rejection.reason, message: rejection.message };
    }
    throw err; // Unexpected precheck failure — let the controller surface a 500.
  }

  if (precheck.alreadyIngested) {
    return { kind: 'cached', repoId: precheck.repoId };
  }

  let jobId: string;
  try {
    jobId = await deps.enqueue(url);
  } catch (err) {
    // Redis/queue unreachable — the one failure mode that is a 503, not a 500.
    return { kind: 'unavailable', message: messageOf(err) };
  }
  return { kind: 'queued', jobId };
}

/** A read-only snapshot of a BullMQ job, as the GET route sees it. */
export interface JobView {
  id: string;
  /** Raw BullMQ state: waiting/active/completed/failed/delayed/... */
  state: string;
  /** Last `job.updateProgress` payload (object) or a bare number, or undefined. */
  progress: unknown;
  /** `job.returnvalue` — the engine's `IngestResult` on success. */
  returnvalue: unknown;
  /** `job.failedReason` — a plain string; may be a JSON-encoded `{reason,message}`. */
  failedReason?: string;
}

/** Maps BullMQ's raw job state to the frozen `status` vocabulary. */
export function mapStatus(state: string): JobStatus {
  switch (state) {
    case 'active':
      return 'active';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    // waiting, waiting-children, delayed, prioritized, unknown → not yet running.
    default:
      return 'queued';
  }
}

/**
 * The `GET /api/ingest/:jobId` mapping: a job snapshot → the frozen response.
 * `phase`/`counts` come from the latest progress; `repoId` from the return
 * value on completion; `error` from the stashed structured progress error or,
 * failing that, the (possibly JSON-encoded) `failedReason`.
 */
export function describeJob(view: JobView): JobStatusResponse {
  const status = mapStatus(view.state);
  const progress = asProgress(view.progress);

  const response: JobStatusResponse = {
    jobId: view.id,
    status,
    phase: progress?.phase ?? 'queued',
  };

  if (progress?.counts && Object.keys(progress.counts).length > 0) {
    response.counts = progress.counts;
  }

  if (status === 'completed') {
    const result = view.returnvalue as { repoId?: string } | null | undefined;
    if (result && typeof result.repoId === 'string') {
      response.repoId = result.repoId;
    }
    // The engine's terminal phase is `ready`; reflect it even if the last
    // progress event hadn't landed by the time the job completed.
    response.phase = progress?.phase ?? 'ready';
  }

  if (status === 'failed') {
    response.phase = 'failed';
    response.error = failureError(progress, view.failedReason);
  }

  return response;
}

/** Resolves the structured failure: prefer the stashed progress error, else the failedReason. */
function failureError(progress: IngestJobProgress | undefined, failedReason?: string): JobError {
  if (progress?.error && typeof progress.error.message === 'string') {
    return progress.error;
  }
  if (failedReason) {
    // The worker JSON-encodes `IngestRejected` into failedReason; decode it back.
    try {
      const parsed = JSON.parse(failedReason) as Partial<JobError>;
      if (parsed && typeof parsed.message === 'string') {
        return parsed.reason ? { reason: parsed.reason, message: parsed.message } : { message: parsed.message };
      }
    } catch {
      // Not JSON — a plain error string.
    }
    return { message: failedReason };
  }
  return { message: 'ingest failed' };
}

/** Coerces `job.progress` (object | number | undefined) to our progress shape. */
function asProgress(progress: unknown): IngestJobProgress | undefined {
  if (progress && typeof progress === 'object' && 'phase' in (progress as object)) {
    return progress as IngestJobProgress;
  }
  return undefined;
}

/** Best-effort structural narrowing of an unknown throw to a guardrail rejection. */
export function asRejection(err: unknown): RejectionLike | null {
  if (
    err &&
    typeof err === 'object' &&
    (err as { name?: unknown }).name === 'IngestRejected' &&
    typeof (err as { reason?: unknown }).reason === 'string'
  ) {
    const e = err as { reason: RejectionReason; detail?: string; message?: string };
    return { reason: e.reason, message: e.detail ?? e.message ?? 'ingest rejected' };
  }
  return null;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type { IngestCounts, IngestPhase };
