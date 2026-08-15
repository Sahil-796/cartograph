/**
 * MapView — the whole-repo graph, the graded hero of the RepoView screen.
 *
 * Pipeline: fetch `file_graph` + `file_metrics` → build compound-directory /
 * loc-sized / top-N-edge cytoscape elements → fcose layout → recolour live per
 * colour mode → focus + depth neighbourhood on selection. The canvas is the
 * only saturated thing; a single amber accent carries interaction.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — cytoscape-fcose ships no bundled types.
import fcose from "cytoscape-fcose";

import { EmptyState, ErrorBanner, NoResults, Skeleton } from "../../components/states";
import { useRepoStore } from "../../state/repoStore";

import { useGraphData } from "./useGraphData";
import { buildGraph } from "./elements";
import { mapStylesheet } from "./style";
import { colourFor, computeRecencyDomain, type ColourContext } from "./colours";
import {
  clearFocus,
  fetchSymbolOverlay,
  fileNeighbourhood,
  markSelected,
  paintFileFocus,
  renderSymbolOverlay,
} from "./focus";
import { Controls } from "./Controls";
import { Legend } from "./Legend";
import "./map.css";

// Register the fcose layout exactly once, tolerating HMR / StrictMode re-runs.
let fcoseRegistered = false;
if (!fcoseRegistered) {
  try {
    cytoscape.use(fcose);
  } catch {
    /* already registered */
  }
  fcoseRegistered = true;
}

const HIDE_GENERATED = true;

/** Scale the edge cap to the repo so the map reads as structure, not spaghetti. */
function edgeCapFor(nodeCount: number): number {
  return Math.max(300, Math.min(600, Math.round(nodeCount * 1.2)));
}

export interface MapViewProps {
  repoId: string;
}

export default function MapView({ repoId }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [ready, setReady] = useState(false);

  const colourMode = useRepoStore((s) => s.colourMode);
  const depth = useRepoStore((s) => s.depth);
  const selectedNodeId = useRepoStore((s) => s.selectedNodeId);
  const setColourMode = useRepoStore((s) => s.setColourMode);
  const setDepth = useRepoStore((s) => s.setDepth);
  const setSelectedNodeId = useRepoStore((s) => s.setSelectedNodeId);

  // `metricsPending` / `metricsFailed` are also exposed by the hook for a
  // colour-status indicator — left to the UI layer.
  const { loading, connError, otherError, graphRows, metricRows, retry } = useGraphData(repoId);

  // Build the STRUCTURE (nodes/edges/layout input) from `file_graph` alone, so
  // the map draws without waiting on the expensive `file_metrics` query. Metrics
  // are joined into `fileData` in place once they land (below) — keeping this
  // memo keyed only on `graphRows` means metrics never trigger a relayout.
  const built = useMemo(() => {
    if (!graphRows) return null;
    const nodeCount = graphRows.filter((r) => r.kind === "node").length;
    return buildGraph(graphRows, [], {
      hideGenerated: HIDE_GENERATED,
      maxEdges: edgeCapFor(nodeCount),
    });
  }, [graphRows]);

  // Join colour metrics into the already-built file data in place, then bump a
  // version so colour context + recolour re-run — no rebuild, no relayout.
  const [metricsVersion, setMetricsVersion] = useState(0);
  const [presentOwners, setPresentOwners] = useState<string[] | null>(null);
  useEffect(() => {
    if (!built || !metricRows) return;
    for (const m of metricRows) {
      const f = built.fileData.get(m.path);
      if (!f) continue;
      f.ownerName = m.ownerName;
      f.lastCommitAt = m.lastCommitAt;
      f.busFactor = m.busFactor;
      f.coveredByTest = m.coveredByTest;
    }
    const owners = new Set<string>();
    built.fileData.forEach((f) => {
      if (f.ownerName) owners.add(f.ownerName);
    });
    setPresentOwners([...owners].sort());
    setMetricsVersion((v) => v + 1);
  }, [built, metricRows]);

  const colourCtx = useMemo<ColourContext>(
    () => ({
      recency: computeRecencyDomain(built ? [...built.fileData.values()] : []),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [built, metricsVersion],
  );

  // ---- init cytoscape + run fcose (once per built graph) ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !built || built.fileCount === 0) return;

    setReady(false);
    const cy = cytoscape({
      container,
      elements: built.elements,
      style: mapStylesheet(),
      wheelSensitivity: 0.2,
      minZoom: 0.05,
      maxZoom: 3,
      pixelRatio: 1,
    });
    cyRef.current = cy;

    // Interaction wiring.
    cy.on("tap", "node[type = 'file']", (e) => setSelectedNodeId(e.target.id()));
    cy.on("tap", "node[type = 'symbol']", (e) => setSelectedNodeId(e.target.id()));
    cy.on("tap", (e) => {
      if (e.target === cy) setSelectedNodeId(null);
    });
    cy.on("mouseover", "node[type = 'file'], node[type = 'symbol']", (e) => {
      e.target.addClass("hover");
      container.style.cursor = "pointer";
    });
    cy.on("mouseout", "node[type = 'file'], node[type = 'symbol']", (e) => {
      e.target.removeClass("hover");
      container.style.cursor = "";
    });

    const animate = built.fileCount < 400;
    const layout = cy.layout({
      name: "fcose",
      quality: "default",
      animate,
      animationDuration: 600,
      randomize: true,
      fit: true,
      padding: 40,
      nodeSeparation: 80,
      idealEdgeLength: 70,
      nodeRepulsion: 6500,
      gravity: 0.3,
      gravityCompound: 1.2,
      nestingFactor: 0.1,
      packComponents: true,
      tile: true,
    } as cytoscape.LayoutOptions);

    const onStop = () => setReady(true);
    cy.one("layoutstop", onStop);
    layout.run();
    // Safety net in case layoutstop never fires.
    const t = window.setTimeout(onStop, 4000);

    return () => {
      window.clearTimeout(t);
      cyRef.current = null;
      cy.destroy();
    };
  }, [built, setSelectedNodeId]);

  // ---- recolour live on colour-mode change ----
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !built) return;
    cy.batch(() => {
      cy.nodes('[type = "file"]').forEach((n) => {
        const f = built.fileData.get(n.id());
        if (f) n.data("fill", colourFor(colourMode, f, colourCtx));
      });
    });
  }, [colourMode, built, colourCtx, ready]);

  // ---- decide the focus ANCHOR from the current selection ----
  const [anchor, setAnchor] = useState<string | null>(null);
  useEffect(() => {
    const cy = cyRef.current;
    if (!built) return;
    if (selectedNodeId && built.fileData.has(selectedNodeId)) {
      setAnchor(selectedNodeId); // a file → (re)anchor the focus
    } else if (selectedNodeId == null) {
      setAnchor(null); // cleared
    } else if (cy) {
      markSelected(cy, selectedNodeId); // a symbol → just move the highlight
    }
  }, [selectedNodeId, built]);

  // ---- paint structural focus + fetch/render the symbol overlay ----
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !built || !ready) return;

    if (!anchor) {
      clearFocus(cy);
      return;
    }

    const nb = fileNeighbourhood(built.adjacency, anchor, depth);
    paintFileFocus(cy, anchor, nb);
    // Remove any prior overlay before drawing the new one.
    cy.elements('[type = "symbol"], edge.overlay').remove();

    const ctrl = new AbortController();
    fetchSymbolOverlay(repoId, anchor, depth, ctrl.signal)
      .then((overlay) => {
        if (ctrl.signal.aborted || cyRef.current !== cy) return;
        if (overlay) renderSymbolOverlay(cy, anchor, overlay);
      })
      .catch(() => {
        /* overlay is best-effort; structural focus already shows */
      });

    return () => ctrl.abort();
  }, [anchor, depth, built, ready, repoId]);

  // ---- Esc clears the selection/focus ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedNodeId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSelectedNodeId]);

  // ---- keep the graph fitted to the pane on resize ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => cyRef.current?.resize());
    });
    ro.observe(container);
    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // ---- render ----
  if (connError) {
    return (
      <div className="map-state">
        <ErrorBanner error={connError} onRetry={retry} />
      </div>
    );
  }
  if (otherError) {
    return (
      <div className="map-state">
        <NoResults title="Couldn't load the map">
          <p className="map-state__detail">
            {otherError instanceof Error ? otherError.message : "The graph query failed."}
          </p>
        </NoResults>
      </div>
    );
  }
  if (!loading && built && built.fileCount === 0) {
    return (
      <div className="map-state">
        <EmptyState
          icon="🗺"
          title="No graph for this repo yet"
          description={`"${repoId}" has no file graph. Seed the database, then reload.`}
        />
      </div>
    );
  }

  const showSkeleton = loading || !ready;

  return (
    <div className="map-root">
      <div ref={containerRef} className="map-canvas" aria-label="Repository graph" />

      {showSkeleton ? (
        <div className="map-skeleton" role="status" aria-label="Loading the graph">
          <Skeleton width={220} height={220} radius="50%" />
          <div className="map-skeleton__caption">
            {loading ? "Loading graph…" : "Laying out the map…"}
          </div>
        </div>
      ) : null}

      {!showSkeleton && built ? (
        <>
          <Controls
            mode={colourMode}
            onModeChange={setColourMode}
            depth={depth}
            onDepthChange={setDepth}
            focused={anchor != null}
          />
          <Legend
            mode={colourMode}
            present={{ owners: presentOwners ?? built.present.owners, dirs: built.present.dirs }}
          />
        </>
      ) : null}
    </div>
  );
}
