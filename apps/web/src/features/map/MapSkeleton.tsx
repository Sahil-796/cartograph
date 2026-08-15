import { useEffect, useState } from "react";

const TIPS = [
  "Press ⌘K anytime to jump directly to any file, function, or route",
  "Use the Depth slider to explore dependency radius from any node",
  "Double-click anywhere to zoom in, or press F to fit all to screen",
  "Switch color modes to view test coverage, code recency, and ownership",
];

export interface MapSkeletonProps {
  loading: boolean;
}

export function MapSkeleton({ loading }: MapSkeletonProps) {
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTipIndex((i) => (i + 1) % TIPS.length);
    }, 3200);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="map-skeleton" role="status" aria-label="Loading repository map">
      {/* Animated Constellation Skeleton Wireframe */}
      <div className="map-skeleton__constellation">
        <svg
          className="map-skeleton__svg"
          viewBox="0 0 240 240"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Animated pulsing connector lines */}
          <line x1="120" y1="120" x2="60" y2="70" className="map-skeleton__line" />
          <line x1="120" y1="120" x2="180" y2="60" className="map-skeleton__line map-skeleton__line--delayed-1" />
          <line x1="120" y1="120" x2="190" y2="150" className="map-skeleton__line map-skeleton__line--delayed-2" />
          <line x1="120" y1="120" x2="130" y2="190" className="map-skeleton__line map-skeleton__line--delayed-3" />
          <line x1="120" y1="120" x2="50" y2="160" className="map-skeleton__line map-skeleton__line--delayed-1" />
          <line x1="60" y1="70" x2="180" y2="60" className="map-skeleton__line map-skeleton__line--subtle" />
          <line x1="180" y1="60" x2="190" y2="150" className="map-skeleton__line map-skeleton__line--subtle" />
          <line x1="190" y1="150" x2="130" y2="190" className="map-skeleton__line map-skeleton__line--subtle" />
          <line x1="130" y1="190" x2="50" y2="160" className="map-skeleton__line map-skeleton__line--subtle" />
          <line x1="50" y1="160" x2="60" y2="70" className="map-skeleton__line map-skeleton__line--subtle" />

          {/* Glowing node circles */}
          <circle cx="120" cy="120" r="15" className="map-skeleton__node map-skeleton__node--hub" />
          <circle cx="60" cy="70" r="11" className="map-skeleton__node map-skeleton__node--accent" />
          <circle cx="180" cy="60" r="13" className="map-skeleton__node map-skeleton__node--cyan" />
          <circle cx="190" cy="150" r="10" className="map-skeleton__node map-skeleton__node--yellow" />
          <circle cx="130" cy="190" r="12" className="map-skeleton__node map-skeleton__node--purple" />
          <circle cx="50" cy="160" r="9" className="map-skeleton__node map-skeleton__node--green" />
        </svg>

        {/* Ambient background glow */}
        <div className="map-skeleton__ambient-glow" />
      </div>

      {/* Status Titles & Captions */}
      <div className="map-skeleton__content">
        <h3 className="map-skeleton__title">
          {loading ? "Loading codebase graph…" : "Simulating topology & layout…"}
        </h3>
        <p className="map-skeleton__subtitle">
          Resolving import dependencies, test connections & modules
        </p>

        {/* Informative UX Tip Pill */}
        <div className="map-skeleton__tip-card">
          <span className="map-skeleton__tip-badge">TIP</span>
          <span className="map-skeleton__tip-text" key={tipIndex}>
            {TIPS[tipIndex]}
          </span>
        </div>
      </div>
    </div>
  );
}

export default MapSkeleton;
