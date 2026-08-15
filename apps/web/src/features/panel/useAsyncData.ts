/**
 * Tiny per-section data hook. Each panel row owns one of these so it fetches
 * on demand, shows its own loading/error, and aborts + refetches when its
 * dependencies (the selected node) change.
 */

import { useCallback, useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  /** Re-run the fetch (wired to <ErrorBanner onRetry>). */
  retry: () => void;
}

/**
 * Process-wide result cache. A panel row fetches once per `(query, repo, node)`
 * and every later re-selection of that node serves instantly instead of paying
 * the CognoDB round-trip again — the same "store it, don't refetch it" fix the
 * map uses. Graph facts are static within a session, so a plain cache (no TTL)
 * is correct; `retry()` busts the entry to force a fresh fetch.
 */
const resultCache = new Map<string, unknown>();

/**
 * Run `run(signal)` whenever `deps` change (and on retry). Aborts the previous
 * request on change/unmount. Set `enabled` false to hold off fetching. Pass a
 * stable `cacheKey` to memoise the result across mounts (re-selecting a node).
 */
export function useAsyncData<T>(
  run: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  enabled = true,
  cacheKey?: string,
): AsyncState<T> {
  // Seed synchronously from cache so a revisit renders with no skeleton flash.
  const seed = cacheKey !== undefined && resultCache.has(cacheKey) ? (resultCache.get(cacheKey) as T) : null;
  const [data, setData] = useState<T | null>(seed);
  const [loading, setLoading] = useState(enabled && seed === null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    // Cache hit → serve without a network round-trip.
    if (cacheKey !== undefined && resultCache.has(cacheKey)) {
      setData(resultCache.get(cacheKey) as T);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    run(controller.signal)
      .then((result) => {
        if (cacheKey !== undefined) resultCache.set(cacheKey, result);
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err);
        setData(null);
        setLoading(false);
      });

    return () => controller.abort();
    // `run` is recreated each render; the caller declares real deps explicitly.
    // `cacheKey` is derived from those same deps, so it needn't be listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadKey, enabled]);

  const retry = useCallback(() => {
    if (cacheKey !== undefined) resultCache.delete(cacheKey);
    setReloadKey((k) => k + 1);
  }, [cacheKey]);

  return { data, loading, error, retry };
}
