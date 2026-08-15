/**
 * Process-wide cache for the two whole-repo map queries, keyed by repoId.
 *
 * Without this, `MapView` held the rows in component state, so every time the
 * user left the map (e.g. to People) and came back, the component remounted
 * and refetched `file_graph` + `file_metrics` from scratch — on a large repo
 * that is seconds of waiting for data we already had. Here the in-flight
 * promise itself is cached, so concurrent mounts share one request and a
 * revisit resolves instantly from the settled promise.
 *
 * `file_graph` (structure) and `file_metrics` (colour attributes) are cached
 * INDEPENDENTLY: the map can render as soon as the cheap structure query
 * returns, without waiting on — or being sunk by — the expensive metrics
 * query, which can deadline on very large repos. A rejected fetch clears its
 * own slot so a retry can try again; `bust()` drops a repo entirely.
 */

import { runQuery } from "../../lib/api";
import type { FileGraphRow, FileMetricsRow } from "./types";

interface Entry {
  graph?: Promise<FileGraphRow[]>;
  metrics?: Promise<FileMetricsRow[]>;
}

const cache = new Map<string, Entry>();

function entry(repoId: string): Entry {
  let e = cache.get(repoId);
  if (!e) {
    e = {};
    cache.set(repoId, e);
  }
  return e;
}

/**
 * The shared fetch is deliberately started WITHOUT a per-caller AbortSignal:
 * one consumer unmounting must not abort a request other consumers (or a
 * future revisit) are relying on. Callers guard their own `setState` with an
 * alive flag instead.
 */
export function loadGraph(repoId: string): Promise<FileGraphRow[]> {
  const e = entry(repoId);
  if (!e.graph) {
    e.graph = runQuery<FileGraphRow>("file_graph", { repoId }).catch((err) => {
      e.graph = undefined; // let a retry re-issue it
      throw err;
    });
  }
  return e.graph;
}

export function loadMetrics(repoId: string): Promise<FileMetricsRow[]> {
  const e = entry(repoId);
  if (!e.metrics) {
    e.metrics = runQuery<FileMetricsRow>("file_metrics", { repoId }).catch((err) => {
      e.metrics = undefined; // let a retry re-issue it
      throw err;
    });
  }
  return e.metrics;
}

/** Drop a repo's cached data so the next load refetches (used by retry). */
export function bust(repoId: string): void {
  cache.delete(repoId);
}
