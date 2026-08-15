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

export default Controls;
