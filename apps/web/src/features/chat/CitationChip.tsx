import type { Citation } from "./types";

export interface CitationChipProps {
  citation: Citation;
  active: boolean;
  onClick: () => void;
}

/** An inline `[cN]` marker rendered as a clickable amber chip. Clicking it
 * highlights `citation.nodes` on the map (via `repoStore.highlightNodes`) —
 * the whole point of this unit: chat feels wired into the map, not bolted on.
 *
 * Some tool results have no map-addressable node (e.g. `entrypoints`, whose
 * rows are routes + handler names, not files). Those chips render muted and
 * are non-interactive, with a tooltip that says why — better than a dead click
 * that silently does nothing. */
export function CitationChip({ citation, active, onClick }: CitationChipProps) {
  const hasTargets = citation.nodes.length > 0;
  const className = [
    "chat-chip",
    active && "chat-chip--active",
    !hasTargets && "chat-chip--flat",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      onClick={hasTargets ? onClick : undefined}
      disabled={!hasTargets}
      aria-disabled={!hasTargets}
      title={
        hasTargets
          ? `${citation.summary} — click to highlight on the map`
          : `${citation.summary} — no location on the map`
      }
    >
      <span className="chat-chip__id">{citation.id}</span>
      <span className="chat-chip__tool mono">{citation.tool}</span>
    </button>
  );
}

export default CitationChip;
