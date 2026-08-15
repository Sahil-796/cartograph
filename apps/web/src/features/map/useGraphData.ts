/**
 * Whole-repo map data (`file_graph` + `file_metrics`) for a repoId, served
 * through `graphCache` so leaving and returning to the map never refetches.
 *
 * The two queries are DECOUPLED on purpose:
 *   - `file_graph` is the structure — the map draws the moment it lands.
 *   - `file_metrics` is the colour data (owner/recency/bus-factor/coverage) and
 *     is expensive; on very large repos it can deadline server-side. So it is
 *     tracked separately: while it's pending the map is already interactive in
 *     grey, and if it FAILS the map stays up (colours degrade) rather than the
 *     whole screen erroring. Only a `file_graph` failure is a real map error.
 */

import { useCallback, useEffect, useState } from "react";
import { isConnectionError } from "../../lib/api";
import { bust, loadGraph, loadMetrics } from "./graphCache";
import type { FileGraphRow, FileMetricsRow } from "./types";

export interface GraphDataState {
  /** Structure still loading — gate the skeleton on this, not on metrics. */
  loading: boolean;
  /** A connection-class failure of the STRUCTURE query — show the retry banner. */
  connError: unknown | null;
  /** A non-connection structure failure (e.g. bad params). */
  otherError: unknown | null;
  graphRows: FileGraphRow[] | null;
  metricRows: FileMetricsRow[] | null;
  /** Metrics still in flight — colours will fill in shortly. */
  metricsPending: boolean;
  /** Metrics failed (e.g. deadline on a huge repo) — colours unavailable. */
  metricsFailed: boolean;
  retry: () => void;
}

export function useGraphData(repoId: string): GraphDataState {
  const [loading, setLoading] = useState(true);
  const [connError, setConnError] = useState<unknown | null>(null);
  const [otherError, setOtherError] = useState<unknown | null>(null);
  const [graphRows, setGraphRows] = useState<FileGraphRow[] | null>(null);
  const [metricRows, setMetricRows] = useState<FileMetricsRow[] | null>(null);
  const [metricsPending, setMetricsPending] = useState(true);
  const [metricsFailed, setMetricsFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => {
    bust(repoId);
    setNonce((n) => n + 1);
  }, [repoId]);

  useEffect(() => {
    if (!repoId) return;
    let alive = true;
    setLoading(true);
    setConnError(null);
    setOtherError(null);
    setGraphRows(null);
    setMetricRows(null);
    setMetricsPending(true);
    setMetricsFailed(false);

    // Structure — gates the map render.
    loadGraph(repoId)
      .then((rows) => {
        if (alive) setGraphRows(rows);
      })
      .catch((err) => {
        if (!alive) return;
        if (isConnectionError(err)) setConnError(err);
        else setOtherError(err);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    // Colour metrics — independent; failure degrades, never blocks.
    loadMetrics(repoId)
      .then((rows) => {
        if (alive) setMetricRows(rows);
      })
      .catch(() => {
        if (!alive) return;
        setMetricRows([]); // build with grey/unknown colours
        setMetricsFailed(true);
      })
      .finally(() => {
        if (alive) setMetricsPending(false);
      });

    return () => {
      alive = false;
    };
  }, [repoId, nonce]);

  return {
    loading,
    connError,
    otherError,
    graphRows,
    metricRows,
    metricsPending,
    metricsFailed,
    retry,
  };
}
