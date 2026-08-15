/**
 * `useIngest` — owns the paste-a-URL ingestion flow.
 *
 * `start(url)` POSTs to `/api/ingest`. Three things can happen:
 *   - 200 cached  → short-circuit straight to `status: "completed"` with `repoId`.
 *   - 202 queued  → poll `GET /api/ingest/:jobId` every ~1s, updating `phase`/
 *                   `counts` as they arrive, until `completed` or `failed`.
 *   - 400 rejected → `status: "rejected"`, `rejection` holds `{ reason, message }`.
 *   - network/503/other → `status: "error"`, `error` holds the thrown Error.
 *
 * Polling gives up after `MAX_POLL_MS` (~3.5min, matching the backend's own
 * ingest timeout) and reports it as a timeout error rather than spinning
 * forever.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getIngestStatus, isIngestQueueDown, startIngest, IngestRejectedError } from "./ingestApi";
import type { IngestCounts, IngestPhase, RejectionReason } from "./types";

export type IngestStatus =
  | "idle"
  | "starting"
  | "polling"
  | "completed"
  | "rejected"
  | "queueDown"
  | "error";

export interface IngestRejection {
  reason: RejectionReason;
  message: string;
}

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_MS = 3.5 * 60 * 1000;

export function useIngest() {
  const [status, setStatus] = useState<IngestStatus>("idle");
  const [phase, setPhase] = useState<IngestPhase | null>(null);
  const [counts, setCounts] = useState<IngestCounts | undefined>(undefined);
  const [repoId, setRepoId] = useState<string | null>(null);
  const [rejection, setRejection] = useState<IngestRejection | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Guards against a stale poll loop (from a previous `start`/unmount)
  // writing state after a newer run has taken over.
  const runIdRef = useRef(0);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    setStatus("idle");
    setPhase(null);
    setCounts(undefined);
    setRepoId(null);
    setRejection(null);
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
    };
  }, []);

  const start = useCallback(async (url: string) => {
    const runId = ++runIdRef.current;
    setStatus("starting");
    setPhase(null);
    setCounts(undefined);
    setRepoId(null);
    setRejection(null);
    setError(null);

    try {
      const result = await startIngest(url);
      if (runIdRef.current !== runId) return;

      if (result.kind === "cached") {
        setRepoId(result.repoId);
        setPhase("ready");
        setStatus("completed");
        return;
      }

      // Accepted — begin polling.
      setStatus("polling");
      setPhase("queued");
      const jobId = result.jobId;
      const deadline = Date.now() + MAX_POLL_MS;

      const poll = async () => {
        if (runIdRef.current !== runId) return;
        if (Date.now() > deadline) {
          setError(new Error("Ingestion is taking longer than expected. Please try again."));
          setStatus("error");
          return;
        }
        try {
          const job = await getIngestStatus(jobId);
          if (runIdRef.current !== runId) return;

          setPhase(job.phase);
          if (job.counts) setCounts(job.counts);

          if (job.status === "completed" && job.repoId) {
            setRepoId(job.repoId);
            setStatus("completed");
            return;
          }
          if (job.status === "failed") {
            if (job.error?.reason) {
              setRejection({ reason: job.error.reason, message: job.error.message });
              setStatus("rejected");
            } else {
              setError(new Error(job.error?.message ?? "Ingestion failed."));
              setStatus("error");
            }
            return;
          }

          setTimeout(() => void poll(), POLL_INTERVAL_MS);
        } catch (err) {
          if (runIdRef.current !== runId) return;
          setError(err instanceof Error ? err : new Error("Failed to check ingest status."));
          setStatus("error");
        }
      };

      setTimeout(() => void poll(), POLL_INTERVAL_MS);
    } catch (err) {
      if (runIdRef.current !== runId) return;
      if (err instanceof IngestRejectedError) {
        setRejection({ reason: err.reason, message: err.message });
        setStatus("rejected");
        return;
      }
      if (isIngestQueueDown(err)) {
        setError(err instanceof Error ? err : new Error("The ingestion queue is unavailable right now."));
        setStatus("queueDown");
        return;
      }
      setError(err instanceof Error ? err : new Error("Failed to start ingestion."));
      setStatus("error");
    }
  }, []);

  return { status, phase, counts, repoId, rejection, error, start, reset };
}
