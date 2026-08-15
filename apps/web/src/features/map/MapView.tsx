import { EmptyState } from "../../components/states";

/**
 * STUB — to be implemented in Wave 2 (map feature agent).
 *
 * Contract this stub locks in for the layout and the feature agent:
 *   - default export named `MapView`
 *   - props: `{ repoId: string }`
 *   - reads `colourMode` / `depth` from `useRepoStore` and renders a
 *     cytoscape graph; WRITES `selectedNodeId` (via `setSelectedNodeId`) on
 *     node click. It should fill the whole pane it's given.
 */
export interface MapViewProps {
  /** The repo whose graph to render (from the `/r/:repoId` route param). */
  repoId: string;
}

export default function MapView({ repoId }: MapViewProps) {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
      <EmptyState
        icon="🗺"
        title="Map coming soon"
        description={`The cytoscape graph for "${repoId}" will render here.`}
      />
    </div>
  );
}
