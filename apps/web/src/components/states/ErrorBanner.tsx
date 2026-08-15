import { ApiError } from "../../lib/api";

/**
 * The "can't reach the database" banner.
 *
 * Show this for connection-class failures (network / 5xx — see
 * `isConnectionError` in `lib/api.ts`). It renders a friendly message and a
 * working Retry button that calls back into whatever refetch the caller owns.
 *
 * Pass either a plain `message` or an `error` (an {@link ApiError} or any
 * Error) and the banner will derive sensible copy.
 */
export interface ErrorBannerProps {
  /** The error to describe. Its message is shown as the detail line. */
  error?: unknown;
  /** Override the derived detail line. */
  message?: string;
  /** Headline. Default "Can't reach the database". */
  title?: string;
  /** Called when the user clicks Retry. Omit to hide the button. */
  onRetry?: () => void;
  /** Retry button label. Default "Retry". */
  retryLabel?: string;
}

function detailFrom(error: unknown, message?: string): string {
  if (message) return message;
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "The request failed. Check that the API and CognoDB are running.";
}

export function ErrorBanner({
  error,
  message,
  title = "Can't reach the database",
  onRetry,
  retryLabel = "Retry",
}: ErrorBannerProps) {
  return (
    <div className="cg-banner" role="alert">
      <span className="cg-banner__icon" aria-hidden="true">
        ⚠
      </span>
      <div className="cg-banner__text">
        <div className="cg-banner__title">{title}</div>
        <div className="cg-banner__detail">{detailFrom(error, message)}</div>
      </div>
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export default ErrorBanner;
