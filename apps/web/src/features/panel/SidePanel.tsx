import { useRepoStore } from "../../state/repoStore";
import { EmptyState } from "../../components/states";

/**
 * STUB — to be implemented in Wave 2 (panel feature agent).
 *
 * Contract this stub locks in:
 *   - default export named `SidePanel`
 *   - props: `{ repoId: string }`
 *   - reads `selectedNodeId` (and `panelTab`) from `useRepoStore`; when a node
 *     is selected it fetches detail via the `lib/queries` wrappers and renders
 *     tabbed detail. When nothing is selected it shows the empty state below.
 */
export interface SidePanelProps {
  /** The repo in view (from the `/r/:repoId` route param). */
  repoId: string;
}

export default function SidePanel({ repoId }: SidePanelProps) {
  const selectedNodeId = useRepoStore((s) => s.selectedNodeId);

  if (!selectedNodeId) {
    return (
      <EmptyState
        icon="◎"
        title="No selection"
        description="Pick a node in the map (or press ⌘K to search) to see its owners, neighbours, and coupling here."
      />
    );
  }

  return (
    <EmptyState
      icon="🧭"
      title="Panel coming soon"
      description={`Detail for "${selectedNodeId}" in ${repoId} will render here.`}
    />
  );
}
