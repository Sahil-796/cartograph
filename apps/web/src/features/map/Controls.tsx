/**
 * Overlaid map controls: a minimal amber segmented control for the colour mode
 * and a depth slider (1→5) for the focus neighbourhood. Both drive the shared
 * repoStore so the side panel stays in sync.
 */

import type { ColourMode } from "../../state/repoStore";

const MODES: { value: ColourMode; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "recency", label: "Recency" },
  { value: "busFactor", label: "Bus factor" },
  { value: "coverage", label: "Coverage" },
  { value: "directory", label: "Directory" },
];

export interface ControlsProps {
  mode: ColourMode;
  onModeChange: (m: ColourMode) => void;
  depth: number;
  onDepthChange: (d: number) => void;
  /** Whether a node is currently focused (depth slider is only live then). */
  focused: boolean;
}

export function Controls({ mode, onModeChange, depth, onDepthChange, focused }: ControlsProps) {
  return (
    <div className="map-controls">
      <div className="map-segmented" role="radiogroup" aria-label="Colour mode">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={mode === m.value}
            className={`map-segmented__btn${mode === m.value ? " is-active" : ""}`}
            onClick={() => onModeChange(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className={`map-depth${focused ? "" : " is-idle"}`}>
        <label className="map-depth__label" htmlFor="map-depth-range">
          Depth
          <span className="map-depth__value">{depth}</span>
        </label>
        <input
          id="map-depth-range"
          type="range"
          min={1}
          max={5}
          step={1}
          value={depth}
          onChange={(e) => onDepthChange(Number(e.target.value))}
          aria-label="Neighbourhood depth in hops"
        />
        <span className="map-depth__hint">
          {focused ? "hops from selection" : "select a node to explore"}
        </span>
      </div>
    </div>
  );
}

export interface NavToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onCenterSelected?: () => void;
  hasSelection: boolean;
}

export function NavToolbar({
  onZoomIn,
  onZoomOut,
  onFit,
  onCenterSelected,
  hasSelection,
}: NavToolbarProps) {
  return (
    <div className="map-nav-toolbar" role="toolbar" aria-label="Navigation controls">
      <button
        type="button"
        className="map-nav-btn"
        onClick={onZoomIn}
        title="Zoom in (+)"
        aria-label="Zoom in"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <button
        type="button"
        className="map-nav-btn"
        onClick={onZoomOut}
        title="Zoom out (−)"
        aria-label="Zoom out"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <div className="map-nav-divider" />
      <button
        type="button"
        className="map-nav-btn"
        onClick={onFit}
        title="Fit whole graph to screen (F or 0)"
        aria-label="Fit all to view"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>
      {hasSelection && onCenterSelected && (
        <button
          type="button"
          className="map-nav-btn is-active"
          onClick={onCenterSelected}
          title="Center on selected node"
          aria-label="Center on selected node"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default Controls;
