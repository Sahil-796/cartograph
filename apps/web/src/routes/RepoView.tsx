import { useState } from "react";
import { useParams } from "react-router-dom";
import MapView from "../features/map/MapView";
import SidePanel from "../features/panel/SidePanel";
import ChatPanel from "../features/chat/ChatPanel";

type SidePane = "detail" | "chat";

/**
 * The `/r/:repoId` index route: the two-pane RepoView. The map fills the left
 * pane and writes selection into the shared store. The right pane is a small
 * tabbed dock over two views that both key off the same `repoId`:
 *   - "Detail" — `SidePanel`, reading `selectedNodeId` from the store.
 *   - "Chat"   — `ChatPanel` (Phase 5 / Unit C), which composes the fixed
 *     query tools and answers with clickable citations; clicking one writes
 *     `highlightedNodes` so the map rings the referenced nodes.
 */
export default function RepoView() {
  const { repoId = "" } = useParams();
  const [sidePane, setSidePane] = useState<SidePane>("detail");

  return (
    <div className="repoview">
      <section className="repoview__map" aria-label="Repository map">
        <MapView repoId={repoId} />
      </section>
      <aside className="repoview__panel repoview__panel--tabbed" aria-label="Node detail and chat">
        <nav className="repoview__panel-tabs" role="tablist" aria-label="Side pane view">
          <button
            type="button"
            role="tab"
            aria-selected={sidePane === "detail"}
            className={`repoview__panel-tab${sidePane === "detail" ? " repoview__panel-tab--active" : ""}`}
            onClick={() => setSidePane("detail")}
          >
            Detail
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sidePane === "chat"}
            className={`repoview__panel-tab${sidePane === "chat" ? " repoview__panel-tab--active" : ""}`}
            onClick={() => setSidePane("chat")}
          >
            Chat
          </button>
        </nav>
        <div className="repoview__panel-body" role="tabpanel">
          {sidePane === "detail" ? <SidePanel repoId={repoId} /> : <ChatPanel repoId={repoId} />}
        </div>
      </aside>
    </div>
  );
}
