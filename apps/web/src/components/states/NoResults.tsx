import type { ReactNode } from "react";

/**
 * Shown when a search or query ran successfully but returned zero rows.
 * Unlike {@link EmptyState}, this actively suggests what to try next — either
 * as free-form `children` or as a list of clickable `suggestions`.
 */
export interface NoResultsProps {
  /** Headline. Default "No results". */
  title?: string;
  /** What the user searched for, echoed back (e.g. the query term). */
  query?: string;
  /**
   * Clickable suggestions rendered as pills. `onSuggestionClick` receives the
   * chosen suggestion's `value` (falls back to its `label`).
   */
  suggestions?: { label: string; value?: string }[];
  onSuggestionClick?: (value: string) => void;
  /** Free-form guidance rendered instead of / below suggestions. */
  children?: ReactNode;
}

export function NoResults({
  title = "No results",
  query,
  suggestions,
  onSuggestionClick,
  children,
}: NoResultsProps) {
  return (
    <div className="cg-state cg-noresults">
      <div className="cg-state__icon" aria-hidden="true">
        ⌕
      </div>
      <div className="cg-state__title">{title}</div>
      <p className="cg-state__body">
        {query ? (
          <>
            Nothing matched <span className="mono">{query}</span>.{" "}
          </>
        ) : null}
        Try a broader term or a different node kind.
      </p>
      {suggestions && suggestions.length > 0 ? (
        <ul className="cg-noresults__suggestions">
          {suggestions.map((s) => (
            <li key={s.value ?? s.label}>
              <button
                type="button"
                className="tag"
                onClick={() => onSuggestionClick?.(s.value ?? s.label)}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {children}
    </div>
  );
}

export default NoResults;
