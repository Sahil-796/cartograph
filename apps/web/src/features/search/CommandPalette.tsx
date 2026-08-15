import { useEffect, useState } from "react";

/**
 * STUB — to be implemented in Wave 2 (search feature agent).
 *
 * Contract this stub locks in:
 *   - default export named `CommandPalette`
 *   - a GLOBAL overlay, mounted once at the app root (see `app/App.tsx`).
 *   - props: `{ repoId?: string }` — the repo to scope search to, if any
 *     (undefined on the `/` picker where there is no repo yet).
 *   - opens on ⌘K / Ctrl-K; uses the `search` wrapper from `lib/queries`; on
 *     pick, writes `selectedNodeId` via `useRepoStore` and navigates as needed.
 *
 * This stub wires the ⌘K key handler + a minimal overlay so the shortcut is
 * live today (and visibly does something) before the real palette lands. It
 * intentionally does not query anything yet.
 */
export interface CommandPaletteProps {
  /** Repo to scope search to; undefined when no repo is selected. */
  repoId?: string;
}

export default function CommandPalette({ repoId }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={() => setOpen(false)}
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "start center",
        paddingTop: "18vh",
        background: "rgba(0,0,0,0.45)",
        zIndex: 100,
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(560px, 92vw)", padding: "var(--space-5)" }}
      >
        <div style={{ fontWeight: 600, marginBottom: "var(--space-2)" }}>
          Search coming soon
        </div>
        <p className="muted" style={{ fontSize: "var(--text-sm)", margin: 0 }}>
          The ⌘K command palette{repoId ? ` for "${repoId}"` : ""} will search
          files, symbols and entrypoints here. Press Esc to close.
        </p>
      </div>
    </div>
  );
}
