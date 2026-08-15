import { useEffect } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { getDemoRepo } from "../data/repos";
import { useRepoStore } from "../state/repoStore";
import CommandPalette from "../features/search/CommandPalette";

/**
 * Chrome for the `/r/:repoId` routes: a top bar (brand + repo name + Map /
 * People nav + ⌘K hint), the globally-mounted command palette, and an
 * `<Outlet>` for the child route (the two-pane RepoView, or People).
 *
 * Resets the shared RepoView store whenever the repoId changes so selection /
 * panel state never leaks from one repo to the next.
 */
export default function RepoChrome() {
  const { repoId = "" } = useParams();
  const reset = useRepoStore((s) => s.reset);
  const repo = getDemoRepo(repoId);

  useEffect(() => {
    reset();
  }, [repoId, reset]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="topbar__brand">
          <span className="topbar__brand-mark">◆</span>
          Cartograph
        </NavLink>
        <span className="muted mono" style={{ fontSize: "var(--text-sm)" }}>
          / {repo?.name ?? repoId}
        </span>

        <span className="topbar__spacer" />

        <nav className="topbar__nav">
          <NavLink
            to={`/r/${repoId}`}
            end
            className={({ isActive }) =>
              `topbar__link${isActive ? " topbar__link--active" : ""}`
            }
          >
            Map
          </NavLink>
          <NavLink
            to={`/r/${repoId}/people`}
            className={({ isActive }) =>
              `topbar__link${isActive ? " topbar__link--active" : ""}`
            }
          >
            People
          </NavLink>
        </nav>

        <span className="topbar__kbd" title="Open search">
          ⌘K
        </span>
      </header>

      <Outlet />

      {/* Global ⌘K palette for this repo view. */}
      <CommandPalette repoId={repoId} />
    </div>
  );
}
