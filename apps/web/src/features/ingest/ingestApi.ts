/**
 * Typed client for `POST /api/ingest` + `GET /api/ingest/:jobId` (Phase 6 /
 * Unit C).
 *
 * Mirrors `lib/api.ts`'s fetch/error style so callers can key off the same
 * `ApiError`/`isConnectionError` helpers, without modifying that file. Two
 * wrinkles vs. `runQuery`:
 *   - The 400 body here is `{ reason, message }`, not zod issues — so
 *     rejections throw {@link IngestRejectedError}, a small `ApiError`
 *     subclass carrying `reason` for reason-specific copy.
 *   - `POST /api/ingest` has a "success but different shape" split: 202
 *     (queued) vs. 200 (cached hit). `startIngest` returns a tagged union
 *     instead of throwing for either.
 */

import { ApiError, apiUrl, type ApiIssue } from "../../lib/api";
import type {
  IngestAcceptedResponse,
  IngestCachedResponse,
  IngestJobStatusResponse,
  RejectionReason,
} from "./types";

/** Thrown for a `POST /api/ingest` 400 — the repo was rejected outright.
 * `reason` drives which rejection panel renders; `message` is the backend's
 * human-readable copy to show verbatim. */
export class IngestRejectedError extends ApiError {
  readonly reason: RejectionReason;

  constructor(reason: RejectionReason, message: string) {
    super("validation", message, 400);
    this.name = "IngestRejectedError";
    this.reason = reason;
  }
}

/** True when the failure means "the ingestion queue is down" (503), not a
 * validation/rejection or a real backend/db failure. */
export function isIngestQueueDown(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503;
}

export type StartIngestResult =
  | ({ kind: "accepted" } & IngestAcceptedResponse)
  | ({ kind: "cached" } & IngestCachedResponse);

async function readJsonBody(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * POST a GitHub URL to `/api/ingest`. Resolves to `{ kind: "accepted",
 * jobId }` (202) or `{ kind: "cached", repoId }` (200). Throws
 * {@link IngestRejectedError} on 400, or {@link ApiError} for transport
 * failures / 503 (queue down) / any other non-2xx.
 */
export async function startIngest(
  url: string,
  signal?: AbortSignal,
): Promise<StartIngestResult> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/ingest"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(
      "network",
      "Could not reach the Cartograph API. Is the server running?",
    );
  }

  if (res.status === 202) {
    const body = (await res.json()) as IngestAcceptedResponse;
    return { kind: "accepted", jobId: body.jobId };
  }
  if (res.status === 200) {
    const body = (await res.json()) as IngestCachedResponse;
    return { kind: "cached", repoId: body.repoId, cached: true };
  }

  const body = await readJsonBody(res);
  if (res.status === 400) {
    const reason = (body.reason as RejectionReason | undefined) ?? "invalid_url";
    throw new IngestRejectedError(
      reason,
      (body.message as string | undefined) ?? "This repository can't be ingested.",
    );
  }
  if (res.status === 503) {
    throw new ApiError(
      "server",
      (body.message as string | undefined) ?? "The ingestion queue is unavailable right now.",
      503,
    );
  }
  throw new ApiError(
    "server",
    (body.message as string | undefined) ?? `Ingestion failed (HTTP ${res.status}).`,
    res.status,
    body.issues as ApiIssue[] | undefined,
  );
}

/**
 * GET the status of an ingestion job. Throws {@link ApiError} (`kind:
 * "notFound"`) on 404 (unknown jobId), or the usual transport/5xx failures.
 */
export async function getIngestStatus(
  jobId: string,
  signal?: AbortSignal,
): Promise<IngestJobStatusResponse> {
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/ingest/${encodeURIComponent(jobId)}`), { signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(
      "network",
      "Could not reach the Cartograph API. Is the server running?",
    );
  }

  if (res.ok) {
    return (await res.json()) as IngestJobStatusResponse;
  }

  const body = await readJsonBody(res);
  if (res.status === 404) {
    throw new ApiError(
      "notFound",
      (body.message as string | undefined) ?? `Unknown ingestion job "${jobId}".`,
      404,
    );
  }
  throw new ApiError(
    "server",
    (body.message as string | undefined) ?? `Failed to check ingest status (HTTP ${res.status}).`,
    res.status,
  );
}
