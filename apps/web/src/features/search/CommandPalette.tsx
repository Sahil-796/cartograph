import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";

import { search, type SearchRow, type NodeKind } from "../../lib/queries";
import { ApiError, isConnectionError } from "../../lib/api";
import { useRepoStore } from "../../state/repoStore";
import { Skeleton, NoResults, ErrorBanner } from "../../components/states";
import "./command-palette.css";

/**
 * The global ⌘K command palette.
 *
 * Mounted once per repo view by `app/RepoChrome.tsx` as
 * `<CommandPalette repoId={repoId} />` — it OWNS its own open state and the
 * ⌘K / Ctrl-K keyboard toggle (the contract the stub locked in). Typing runs
 * the `search` wrapper against the current repo, groups the results by kind,
 * and — on pick — writes `selectedNodeId` (opening the side panel) and closes.
 */
export interface CommandPaletteProps {
  /** Repo to scope search to; undefined when no repo is selected. */
  repoId?: string;
}

const DEBOUNCE_MS = 160;

/** Display metadata per node kind (group order + badge label). */
const KIND_META: Record<NodeKind, { group: string; badge: string }> = {
  file: { group: "Files", badge: "File" },
  symbol: { group: "Symbols", badge: "Symbol" },
  entrypoint: { group: "Entrypoints", badge: "Route" },
};
const KIND_ORDER: NodeKind[] = ["file", "symbol", "entrypoint"];

export default function CommandPalette({ repoId }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const navigate = useNavigate();
  const setSelectedNodeId = useRepoStore((s) => s.setSelectedNodeId);

  // ---- ⌘K / Ctrl-K global toggle (owned here, per the stub contract) ----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset transient state each time the palette closes.
  useEffect(() => {
    if (!open) {
      setTerm("");
      setDebounced("");
      setRows([]);
      setError(null);
      setLoading(false);
    }
  }, [open]);

  // Debounce the query term.
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(term.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [term]);

  // Run the search whenever the debounced term (or repo / retry) changes.
  useEffect(() => {
    if (!open || !repoId || debounced === "") {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    search(repoId, debounced, {}, controller.signal)
      .then((result) => {
        setRows(result);
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err);
        setRows([]);
        setLoading(false);
      });

    return () => controller.abort();
  }, [open, repoId, debounced, reloadKey]);

  const onSelect = useCallback(
    (row: SearchRow) => {
      // Focus the node (also opens the side panel) and close the palette.
      setSelectedNodeId(row.id);
      setOpen(false);
      // Ensure we're on the repo's map route so map + panel are visible.
      if (repoId) navigate(`/r/${repoId}`);
    },
    [navigate, repoId, setSelectedNodeId],
  );

  // Group results into the fixed kind order.
  const groups = useMemo(() => {
    return KIND_ORDER.map((kind) => ({
      kind,
      meta: KIND_META[kind],
      items: rows.filter((r) => r.type === kind),
    })).filter((g) => g.items.length > 0);
  }, [rows]);

  const hasQuery = debounced !== "";
  const connectionError = error != null && isConnectionError(error);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      shouldFilter={false}
      overlayClassName="cg-cmdk__overlay"
      contentClassName="cg-cmdk"
      loop
    >
      <div className="cg-cmdk__inputrow">
        <span className="cg-cmdk__search-icon" aria-hidden="true">
          ⌕
        </span>
        <Command.Input
          className="cg-cmdk__input"
          value={term}
          onValueChange={setTerm}
          placeholder={
            repoId
              ? "Search files, symbols, entrypoints…"
              : "Open a repo to search"
          }
          disabled={!repoId}
          autoFocus
        />
        <span className="cg-cmdk__esc">esc</span>
      </div>

      <Command.List className="cg-cmdk__list">
        <PaletteBody
          repoId={repoId}
          hasQuery={hasQuery}
          loading={loading}
          error={error}
          connectionError={connectionError}
          term={debounced}
          groups={groups}
          onSelect={onSelect}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      </Command.List>
    </Command.Dialog>
  );
}

interface PaletteBodyProps {
  repoId?: string;
  hasQuery: boolean;
  loading: boolean;
  error: unknown;
  connectionError: boolean;
  term: string;
  groups: {
    kind: NodeKind;
    meta: { group: string; badge: string };
    items: SearchRow[];
  }[];
  onSelect: (row: SearchRow) => void;
  onRetry: () => void;
}

function PaletteBody({
  repoId,
  hasQuery,
  loading,
  error,
  connectionError,
  term,
  groups,
  onSelect,
  onRetry,
}: PaletteBodyProps) {
  // No repo context → degrade to a hint.
  if (!repoId) {
    return (
      <div className="cg-cmdk__hint">
        Select a repository first, then press ⌘K to search its files, symbols
        and entrypoints.
      </div>
    );
  }

  // Before typing → a minimal hint.
  if (!hasQuery && !loading && error == null) {
    return (
      <div className="cg-cmdk__hint">
        Start typing to search files, symbols and entrypoints. Use ↑ ↓ to
        navigate, Enter to open.
      </div>
    );
  }

  // Connection error → calm inline banner with retry.
  if (error != null && connectionError) {
    return (
      <div className="cg-cmdk__slot">
        <ErrorBanner error={error} onRetry={onRetry} />
      </div>
    );
  }

  // Non-connection error (bad params / unknown query) → inline detail.
  if (error != null) {
    const detail =
      error instanceof ApiError ? error.message : "Search failed. Try again.";
    return (
      <div className="cg-cmdk__slot">
        <ErrorBanner title="Search failed" message={detail} onRetry={onRetry} />
      </div>
    );
  }

  // Loading → skeleton rows.
  if (loading) {
    return <SkeletonRows />;
  }

  // Ran, zero rows → NoResults with a suggestion.
  if (groups.length === 0) {
    return (
      <div className="cg-cmdk__slot">
        <NoResults query={term}>
          <p className="cg-state__body">
            Try a shorter term, a file name, or part of a path.
          </p>
        </NoResults>
      </div>
    );
  }

  // Results, grouped by kind.
  return (
    <>
      {groups.map((group) => (
        <Command.Group
          key={group.kind}
          heading={group.meta.group}
        >
          {group.items.map((row) => (
            <Command.Item
              key={`${row.type}:${row.id}`}
              value={`${row.type}:${row.id}`}
              className="cg-cmdk__item"
              onSelect={() => onSelect(row)}
            >
              <span className="tag cg-cmdk__badge">{group.meta.badge}</span>
              <span className="cg-cmdk__item-text">
                <span className="cg-cmdk__item-name">{row.name}</span>
                {row.path && row.path !== row.name ? (
                  <span className="cg-cmdk__item-path">{row.path}</span>
                ) : null}
              </span>
            </Command.Item>
          ))}
        </Command.Group>
      ))}
    </>
  );
}

/** A few placeholder rows while the query is in flight. */
function SkeletonRows() {
  return (
    <div role="status" aria-label="Searching">
      {[0, 1, 2, 3].map((i) => (
        <div className="cg-cmdk__skeleton-row" key={i}>
          <Skeleton width={68} height={18} radius="var(--radius-pill)" />
          <span style={{ flex: 1 }}>
            <Skeleton width={i % 2 ? "55%" : "72%"} height={12} />
          </span>
        </div>
      ))}
    </div>
  );
}
