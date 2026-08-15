import type { ReactNode } from "react";
import { SkeletonText, ErrorBanner, NoResults } from "../../components/states";
import { ApiError, isConnectionError } from "../../lib/api";
import type { AsyncState } from "./useAsyncData";

/**
 * Renders the four states of one async panel row consistently:
 *   loading  -> skeleton   |   connection error -> retry banner
 *   param/other error -> inline banner (no retry loop for a bad name/param)
 *   empty (via `isEmpty`) -> NoResults with the caller's guidance
 *   data -> `children(data)`
 */
export interface AsyncSectionProps<T> {
  state: AsyncState<T>;
  /** Return true when `data` has no rows to show. */
  isEmpty?: (data: T) => boolean;
  /** Headline for the empty state. */
  emptyTitle?: string;
  /** Guidance shown in the empty state. */
  emptyHint?: ReactNode;
  /** Skeleton line count while loading. */
  skeletonLines?: number;
  children: (data: T) => ReactNode;
}

export function AsyncSection<T>({
  state,
  isEmpty,
  emptyTitle = "Nothing here",
  emptyHint,
  skeletonLines = 3,
  children,
}: AsyncSectionProps<T>) {
  const { data, loading, error, retry } = state;

  if (loading) {
    return (
      <div className="panel-section__loading">
        <SkeletonText lines={skeletonLines} />
      </div>
    );
  }

  if (error != null) {
    if (isConnectionError(error)) {
      return <ErrorBanner error={error} onRetry={retry} />;
    }
    const detail =
      error instanceof ApiError ? error.message : "This query failed.";
    return <ErrorBanner title="Query failed" message={detail} onRetry={retry} />;
  }

  if (data == null || (isEmpty && isEmpty(data))) {
    return (
      <NoResults title={emptyTitle}>
        {emptyHint ? <p className="cg-state__body">{emptyHint}</p> : null}
      </NoResults>
    );
  }

  return <>{children(data)}</>;
}

export default AsyncSection;
