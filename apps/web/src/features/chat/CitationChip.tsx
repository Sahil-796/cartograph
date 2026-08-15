import type { Citation } from "./types";

export interface CitationChipProps {
  citation: Citation;
  active: boolean;
  onClick: () => void;
}

/** An inline `[cN]` marker rendered as a clickable amber chip. Clicking it
 * highlights `citation.nodes` on the map (via `repoStore.highlightNodes`) —
 * the whole point of this unit: chat feels wired into the map, not bolted on. */
export function CitationChip({ citation, active, onClick }: CitationChipProps) {
  return (
    <button
      type="button"
      className={`chat-chip${active ? " chat-chip--active" : ""}`}
      onClick={onClick}
      title={citation.summary}
    >
      <span className="chat-chip__id">{citation.id}</span>
      <span className="chat-chip__tool mono">{citation.tool}</span>
    </button>
  );
}

export default CitationChip;
