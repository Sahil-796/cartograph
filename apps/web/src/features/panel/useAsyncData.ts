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
 * Run `run(signal)` whenever `deps` change (and on retry). Aborts the previous
 * request on change/unmount. Set `enabled` false to hold off fetching.
 */
export function useAsyncData<T>(
  run: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  enabled = true,
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    run(controller.signal)
      .then((result) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadKey, enabled]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return { data, loading, error, retry };
}
