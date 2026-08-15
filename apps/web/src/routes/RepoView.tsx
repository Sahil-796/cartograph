import { useParams } from "react-router-dom";
import MapView from "../features/map/MapView";
import SidePanel from "../features/panel/SidePanel";

/**
 * The `/r/:repoId` index route: the two-pane RepoView. The map fills the left
 * pane and writes selection into the shared store; the side panel fills the
 * right pane and reads that selection. Both are Wave-2 stubs today.
 */
export default function RepoView() {
  const { repoId = "" } = useParams();

  return (
    <div className="repoview">
      <section className="repoview__map" aria-label="Repository map">
        <MapView repoId={repoId} />
      </section>
      <aside className="repoview__panel" aria-label="Node detail">
        <SidePanel repoId={repoId} />
      </aside>
    </div>
  );
}
