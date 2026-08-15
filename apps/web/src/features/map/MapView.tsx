/**
 * MapView — the whole-repo graph, the graded hero of the RepoView screen.
 *
 * Pipeline: fetch `file_graph` + `file_metrics` → build compound-directory /
 * loc-sized / top-N-edge cytoscape elements → fcose layout → recolour live per
 * colour mode → focus + depth neighbourhood on selection. The canvas is the
 * only saturated thing; a single amber accent carries interaction.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — cytoscape-fcose ships no bundled types.
import fcose from "cytoscape-fcose";

import { EmptyState, ErrorBanner, NoResults } from "../../components/states";
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
import { Controls, NavToolbar } from "./Controls";
import { Legend } from "./Legend";
import { MapSkeleton } from "./MapSkeleton";
import { applyHighlight } from "./highlight";
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

interface HoveredNodeInfo {
  id: string;
  name: string;
  path: string;
  loc?: number;
  isTest?: boolean;
  type: "file" | "symbol";
  ownerName?: string | null;
  busFactor?: number;
  coveredByTest?: boolean;
  x: number;
  y: number;
}

export default function MapView({ repoId }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [ready, setReady] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<HoveredNodeInfo | null>(null);

  const colourMode = useRepoStore((s) => s.colourMode);
  const depth = useRepoStore((s) => s.depth);
  const selectedNodeId = useRepoStore((s) => s.selectedNodeId);
  const highlightedNodes = useRepoStore((s) => s.highlightedNodes);
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
    container.style.cursor = "grab";

    const cy = cytoscape({
      container,
      elements: built.elements,
      style: mapStylesheet(),
      wheelSensitivity: 1.3, // Fast, natural, and responsive zooming
      minZoom: 0.02,
      maxZoom: 5.0,
      pixelRatio: 1,
      boxSelectionEnabled: false,
      userPanningEnabled: true,
      userZoomingEnabled: true,
      autoungrabify: false,
    });
    cyRef.current = cy;

    // Interaction wiring.
    cy.on("tap", "node[type = 'file']", (e) => setSelectedNodeId(e.target.id(), "file"));
    cy.on("tap", "node[type = 'symbol']", (e) => setSelectedNodeId(e.target.id(), "symbol"));
    cy.on("tap", (e) => {
      if (e.target === cy) {
        setSelectedNodeId(null);
        setHoveredNode(null);
      }
    });

    // Double tap/click on background to smoothly zoom in towards cursor
    cy.on("dblclick", (e) => {
      if (e.target === cy) {
        const renderPos = e.renderedPosition;
        const currentZoom = cy.zoom();
        const factor = 1.45;
        cy.animate({
          zoom: currentZoom * factor,
          pan: {
            x: renderPos.x - (renderPos.x - cy.pan().x) * factor,
            y: renderPos.y - (renderPos.y - cy.pan().y) * factor,
          },
          duration: 300,
          easing: "ease-out-cubic",
        });
      }
    });

    // Panning / drag cursor feedback.
    cy.on("grabon", () => {
      container.style.cursor = "grabbing";
      setHoveredNode(null);
    });
    cy.on("pan", () => {
      container.style.cursor = "grabbing";
      setHoveredNode(null);
    });
    cy.on("viewport", () => {
      setHoveredNode(null);
    });

    const onMouseUp = () => {
      if (container) container.style.cursor = "grab";
    };
    container.addEventListener("mouseup", onMouseUp);

    cy.on("mouseover", "node[type = 'file'], node[type = 'symbol']", (e) => {
      const node = e.target;
      node.addClass("hover");
      node.connectedEdges().addClass("hover");
      container.style.cursor = "pointer";

      const id = node.id();
      const f = built.fileData.get(id);
      const isSymbol = node.data("type") === "symbol";
      const renderedPos = node.renderedPosition();

      setHoveredNode({
        id,
        name: isSymbol ? (node.data("label") || id) : (id.split("/").pop() || id),
        path: isSymbol ? `symbol in ${id}` : id,
        loc: f?.loc,
        isTest: f?.isTest,
        type: isSymbol ? "symbol" : "file",
        ownerName: f?.ownerName,
        busFactor: f?.busFactor,
        coveredByTest: f?.coveredByTest,
        x: renderedPos.x,
        y: renderedPos.y,
      });
    });

    cy.on("mouseout", "node[type = 'file'], node[type = 'symbol']", (e) => {
      const node = e.target;
      node.removeClass("hover");
      node.connectedEdges().removeClass("hover");
      container.style.cursor = "grab";
      setHoveredNode(null);
    });

    const animate = built.fileCount < 500;
    const layout = cy.layout({
      name: "fcose",
      quality: "default",
      animate,
      animationDuration: 700,
      randomize: true,
      fit: true,
      padding: 60,
      nodeSeparation: 120,
      idealEdgeLength: 125,
      edgeElasticity: 0.45,
      nodeRepulsion: 22000,
      gravity: 0.12,
      gravityRange: 3.8,
      packComponents: true,
      tile: true,
      tilingPaddingVertical: 45,
      tilingPaddingHorizontal: 45,
    } as cytoscape.LayoutOptions);

    const onStop = () => setReady(true);
    cy.one("layoutstop", onStop);
    layout.run();
    // Safety net in case layoutstop never fires.
    const t = window.setTimeout(onStop, 4000);

    return () => {
      window.clearTimeout(t);
      container.removeEventListener("mouseup", onMouseUp);
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

  // ---- ring nodes referenced by a clicked chat citation chip ----
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready) return;
    applyHighlight(cy, highlightedNodes);
  }, [highlightedNodes, ready]);

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

  // ---- Navigation action helpers ----
  const handleZoomIn = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const center = { x: cy.width() / 2, y: cy.height() / 2 };
    cy.animate({
      zoom: cy.zoom() * 1.55,
      pan: {
        x: cy.pan().x + (center.x - cy.pan().x) * (1 - 1.55),
        y: cy.pan().y + (center.y - cy.pan().y) * (1 - 1.55),
      },
      duration: 200,
      easing: "ease-out-cubic",
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const center = { x: cy.width() / 2, y: cy.height() / 2 };
    cy.animate({
      zoom: cy.zoom() / 1.55,
      pan: {
        x: cy.pan().x + (center.x - cy.pan().x) * (1 - 1 / 1.55),
        y: cy.pan().y + (center.y - cy.pan().y) * (1 - 1 / 1.55),
      },
      duration: 200,
      easing: "ease-out-cubic",
    });
  }, []);

  const handleFit = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.animate({
      fit: {
        eles: cy.elements(),
        padding: 50,
      },
      duration: 400,
      easing: "ease-out-cubic",
    });
  }, []);

  const handleCenterSelected = useCallback(() => {
    const cy = cyRef.current;
    if (!cy || !selectedNodeId) return;
    const target = cy.getElementById(selectedNodeId);
    if (target.nonempty()) {
      cy.animate({
        center: { eles: target },
        zoom: Math.max(cy.zoom(), 0.85),
        duration: 350,
        easing: "ease-out-cubic",
      });
    }
  }, [selectedNodeId]);

  // ---- Smoothly center and spotlight node when selected ----
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready || !selectedNodeId) return;
    const target = cy.getElementById(selectedNodeId);
    if (target.nonempty()) {
      cy.animate({
        center: { eles: target },
        zoom: Math.max(cy.zoom(), 0.9),
        duration: 350,
        easing: "ease-out-cubic",
      });
    }
  }, [selectedNodeId, ready]);

  // ---- Global keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === "Escape") {
        setSelectedNodeId(null);
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        handleZoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        handleZoomOut();
      } else if (e.key === "f" || e.key === "F" || e.key === "0") {
        e.preventDefault();
        handleFit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSelectedNodeId, handleZoomIn, handleZoomOut, handleFit]);

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

      {showSkeleton ? <MapSkeleton loading={loading} /> : null}

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
          <NavToolbar
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onFit={handleFit}
            onCenterSelected={handleCenterSelected}
            hasSelection={selectedNodeId != null}
          />
        </>
      ) : null}

      {/* Interactive hover tooltip */}
      {hoveredNode && !showSkeleton ? (
        <div
          className="map-tooltip"
          style={{
            left: `${Math.min(window.innerWidth - 280, Math.max(16, hoveredNode.x + 14))}px`,
            top: `${Math.max(16, Math.min(window.innerHeight - 150, hoveredNode.y - 20))}px`,
          }}
        >
          <div className="map-tooltip__header">
            <span className={`map-tooltip__badge map-tooltip__badge--${hoveredNode.type}`}>
              {hoveredNode.type === "symbol" ? "Symbol" : hoveredNode.isTest ? "Test" : "File"}
            </span>
            <span className="map-tooltip__name">{hoveredNode.name}</span>
          </div>
          <div className="map-tooltip__path">{hoveredNode.path}</div>
          <div className="map-tooltip__meta">
            {hoveredNode.loc !== undefined && (
              <span className="map-tooltip__meta-item">
                <strong>{hoveredNode.loc.toLocaleString()}</strong> LOC
              </span>
            )}
            {hoveredNode.ownerName && (
              <span className="map-tooltip__meta-item">
                Owner: <strong>{hoveredNode.ownerName}</strong>
              </span>
            )}
            {hoveredNode.busFactor !== undefined && hoveredNode.busFactor > 0 && (
              <span className="map-tooltip__meta-item">
                Bus: <strong>{hoveredNode.busFactor}</strong>
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
