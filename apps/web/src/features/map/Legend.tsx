/**
 * Live legend for the active colour mode. Categorical modes render the keys
 * actually present in the graph; sequential modes render a gradient bar.
 */

import type { ColourMode } from "../../state/repoStore";
import { legendFor } from "./colours";

export interface LegendProps {
  mode: ColourMode;
  present: { owners: string[]; dirs: string[] };
}

export function Legend({ mode, present }: LegendProps) {
  const spec = legendFor(mode, present);
  return (
    <div className="map-legend" role="group" aria-label={`Legend: ${spec.title}`}>
      <div className="map-legend__title">{spec.title}</div>

      {spec.gradient ? (
        <div className="map-legend__gradient-wrap">
          <div className="map-legend__gradient" style={{ background: spec.gradient.css }} />
          <div className="map-legend__gradient-labels">
            <span>{spec.gradient.lowLabel}</span>
            <span>{spec.gradient.highLabel}</span>
          </div>
        </div>
      ) : null}

      {spec.swatches ? (
        <ul className="map-legend__list">
          {spec.swatches.map((s) => (
            <li key={s.label} className="map-legend__item">
              <span className="map-legend__swatch" style={{ background: s.colour }} aria-hidden />
              <span className="map-legend__label" title={s.label}>
                {s.label}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {spec.note ? <div className="map-legend__note">{spec.note}</div> : null}
    </div>
  );
}

export default Legend;
