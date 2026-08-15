/**
 * Fetch the whole-repo map data (`file_graph` + `file_metrics`) for a repoId,
 * with abort-on-unmount/repo-change and a manual `retry()` for the DB-down
 * banner. Returns the raw rows; element-building happens in the component so a
 * colour-only change never refetches.
 */

import { useCallback, useEffect, useState } from "react";
import { runQuery, isConnectionError } from "../../lib/api";
import type { FileGraphRow, FileMetricsRow } from "./types";

export interface GraphDataState {
  loading: boolean;
  /** A connection-class error (network/5xx) — show the retry banner. */
  connError: unknown | null;
  /** Any other error (e.g. bad params) — surfaced but not as a banner. */
  otherError: unknown | null;
  graphRows: FileGraphRow[] | null;
  metricRows: FileMetricsRow[] | null;
  retry: () => void;
}

export function useGraphData(repoId: string): GraphDataState {
  const [loading, setLoading] = useState(true);
  const [connError, setConnError] = useState<unknown | null>(null);
  const [otherError, setOtherError] = useState<unknown | null>(null);
  const [graphRows, setGraphRows] = useState<FileGraphRow[] | null>(null);
  const [metricRows, setMetricRows] = useState<FileMetricsRow[] | null>(null);
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!repoId) return;
    const ctrl = new AbortController();
    let alive = true;
    setLoading(true);
    setConnError(null);
    setOtherError(null);
    setGraphRows(null);
    setMetricRows(null);

    (async () => {
      try {
        const [graph, metrics] = await Promise.all([
          runQuery<FileGraphRow>("file_graph", { repoId }, ctrl.signal),
          runQuery<FileMetricsRow>("file_metrics", { repoId }, ctrl.signal),
        ]);
        if (!alive) return;
        setGraphRows(graph);
        setMetricRows(metrics);
      } catch (err) {
        if (!alive || (err instanceof DOMException && err.name === "AbortError")) return;
        if (isConnectionError(err)) setConnError(err);
        else setOtherError(err);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [repoId, nonce]);

  return { loading, connError, otherError, graphRows, metricRows, retry };
}
