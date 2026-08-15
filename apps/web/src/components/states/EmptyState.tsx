import type { ReactNode } from "react";

/**
 * A neutral "nothing here yet" panel — for a pane that has no selection or no
 * data to show (distinct from {@link NoResults}, which is specifically for a
 * search/query that ran and returned zero rows).
 */
export interface EmptyStateProps {
  /** Short headline, e.g. "Select a node". */
  title: string;
  /** Optional supporting sentence. */
  description?: ReactNode;
  /** Optional leading glyph (emoji or icon element). Default "◎". */
  icon?: ReactNode;
  /** Optional call-to-action (a button/link) rendered under the text. */
  action?: ReactNode;
}

export function EmptyState({ title, description, icon = "◎", action }: EmptyStateProps) {
  return (
    <div className="cg-state">
      <div className="cg-state__icon" aria-hidden="true">
        {icon}
      </div>
      <div className="cg-state__title">{title}</div>
      {description ? <p className="cg-state__body">{description}</p> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export default EmptyState;
