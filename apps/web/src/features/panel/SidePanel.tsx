import { useRepoStore, type PanelTab } from "../../state/repoStore";
import { EmptyState } from "../../components/states";
import { basename, dirname } from "./format";
import {
  OwnersSection,
  TestsSection,
  CoChangeSection,
  BusFactorSection,
  HistorySection,
} from "./sections";
import "./panel.css";

/**
 * The `/r/:repoId` right-pane detail panel.
 *
 * Reads `selectedNodeId` (a file node's id === its path) and `panelTab` from
 * the shared store and renders tabbed, evidence-first detail. Each tab's
 * sections fetch on demand and abort/refetch when the selection changes.
 *
 * Content-section → store `panelTab` mapping (the store's tab set is frozen;
 * we map our five content areas onto it):
 *   overview  -> node identity + Owners (who_touched) + Tests (tests_for_file)
 *   neighbors -> Co-change partners (co_changed)
 *   coupling  -> Bus factor for this file (bus_factor)
 *   history   -> Recent commits (file_commits)
 */
export interface SidePanelProps {
  /** The repo in view (from the `/r/:repoId` route param). */
  repoId: string;
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "neighbors", label: "Co-change" },
  { id: "coupling", label: "Bus factor" },
  { id: "history", label: "History" },
];

export default function SidePanel({ repoId }: SidePanelProps) {
  const selectedNodeId = useRepoStore((s) => s.selectedNodeId);
  const panelTab = useRepoStore((s) => s.panelTab);
  const setPanelTab = useRepoStore((s) => s.setPanelTab);

  if (!selectedNodeId) {
    return (
      <EmptyState
        icon="◎"
        title="No selection"
        description="Pick a node in the map (or press ⌘K to search) to see its owners, co-change partners, and history here."
      />
    );
  }

  const path = selectedNodeId;
  const name = basename(path);
  const dir = dirname(path);

  return (
    <div className="panel">
      <header className="panel__header">
        <div className="panel__eyebrow">File</div>
        <h2 className="panel__name" title={path}>
          {name}
        </h2>
        {dir ? <div className="panel__path mono">{dir}</div> : null}
      </header>

      <nav className="panel__tabs" role="tablist" aria-label="Node detail">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={panelTab === t.id}
            className={`panel__tab${panelTab === t.id ? " panel__tab--active" : ""}`}
            onClick={() => setPanelTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="panel__body" role="tabpanel">
        {/* `key={path}` guarantees a clean remount (and abort) on selection
            change, so no stale row bleeds across nodes. */}
        {panelTab === "overview" && (
          <div key={path} className="panel__stack">
            <OwnersSection repoId={repoId} path={path} />
            <TestsSection repoId={repoId} path={path} />
          </div>
        )}
        {panelTab === "neighbors" && (
          <div key={path} className="panel__stack">
            <CoChangeSection repoId={repoId} path={path} />
          </div>
        )}
        {panelTab === "coupling" && (
          <div key={path} className="panel__stack">
            <BusFactorSection repoId={repoId} path={path} />
          </div>
        )}
        {panelTab === "history" && (
          <div key={path} className="panel__stack">
            <HistorySection repoId={repoId} path={path} />
          </div>
        )}
      </div>
    </div>
  );
}
