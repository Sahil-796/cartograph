/**
 * Focus + depth logic. Two layers, both driven by the depth slider:
 *
 *  1. STRUCTURAL focus — a BFS over the real, visible file→file import edges
 *     from the selected file out to `depth` hops. Highlights that
 *     neighbourhood and dims everything else. Uses only data already on the
 *     canvas, so it is instant and jank-free.
 *
 *  2. SYMBOL neighbourhood — the literal `neighbors` demo. We find the
 *     selected file's own symbols via `search`, then call `neighbors` for a few
 *     of them at `depth` hops and overlay the reachable symbols as an amber
 *     constellation anchored on the file. `neighbors` returns REACHABILITY
 *     (node + hop count), not adjacency, so overlay edges denote "reaches
 *     within N call-hops" and nodes are ringed by hop distance.
 */

import type { Core, ElementDefinition } from "cytoscape";
import { runQuery } from "../../lib/api";
import type { NeighborsRow, SearchRow } from "./types";

// ---- layer 1: structural file neighbourhood ----

/** BFS over the undirected import adjacency; returns path → hop distance. */
export function fileNeighbourhood(
  adjacency: Map<string, Set<string>>,
  start: string,
  depth: number,
): Map<string, number> {
  const byHop = new Map<string, number>([[start, 0]]);
  let frontier = [start];
  for (let hop = 1; hop <= depth; hop++) {
    const next: string[] = [];
    for (const p of frontier) {
      for (const nb of adjacency.get(p) ?? []) {
        if (!byHop.has(nb)) {
          byHop.set(nb, hop);
          next.push(nb);
        }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return byHop;
}

/** Paint the structural focus: selected + neighbours lit, the rest dimmed. */
export function paintFileFocus(cy: Core, start: string, neighbourhood: Map<string, number>): void {
  cy.batch(() => {
    cy.elements().removeClass("dim neighbour selected");
    cy.elements().addClass("dim");
    const inSet = cy.collection();
    for (const path of neighbourhood.keys()) {
      const n = cy.getElementById(path);
      if (n.nonempty()) inSet.merge(n);
    }
    inSet.removeClass("dim").addClass("neighbour");
    // Light the edges wholly inside the neighbourhood.
    inSet.edgesWith(inSet).removeClass("dim").addClass("neighbour");
    // Keep ancestor directory compounds legible.
    inSet.ancestors().removeClass("dim");
    const sel = cy.getElementById(start);
    sel.removeClass("neighbour").addClass("selected");
    sel.ancestors().removeClass("dim");
  });
}

/** Remove all focus/overlay styling and delete overlay elements. */
export function clearFocus(cy: Core): void {
  cy.batch(() => {
    cy.elements().removeClass("dim neighbour selected");
    cy.elements('[type="symbol"], edge.overlay').remove();
  });
}

/** Move just the "selected" ring to a given node id (e.g. a clicked symbol). */
export function markSelected(cy: Core, id: string): void {
  cy.batch(() => {
    cy.elements().removeClass("selected");
    const n = cy.getElementById(id);
    if (n.nonempty()) n.addClass("selected");
  });
}

// ---- layer 2: symbol neighbourhood via `neighbors` ----

export interface SymbolOverlay {
  seeds: SearchRow[];
  /** neighbour id → { row, seedId that reached it at min hops } */
  neighbours: Map<string, { row: NeighborsRow; seedId: string }>;
}

const MAX_SEEDS = 3;
const MAX_NEIGHBOURS = 36;

/**
 * Find the file's symbols and their `neighbors` reachability at `depth` hops.
 * Returns null when the file has no resolvable symbols (graceful degradation —
 * the structural focus still shows).
 */
export async function fetchSymbolOverlay(
  repoId: string,
  filePath: string,
  depth: number,
  signal: AbortSignal,
): Promise<SymbolOverlay | null> {
  // `search` matches symbols whose name OR path contains the term; filtering to
  // an exact path match yields the symbols DEFINED in this file.
  const hits = await runQuery<SearchRow>(
    "search",
    { repoId, term: filePath, kinds: ["symbol"] },
    signal,
  );
  const seeds = hits.filter((h) => h.path === filePath).slice(0, MAX_SEEDS);
  if (seeds.length === 0) return null;

  const neighbours = new Map<string, { row: NeighborsRow; seedId: string }>();
  const results = await Promise.all(
    seeds.map((s) =>
      runQuery<NeighborsRow>(
        "neighbors",
        { repoId, nodeId: s.id, depth, dir: "both" },
        signal,
      ).catch(() => [] as NeighborsRow[]),
    ),
  );
  results.forEach((rows, i) => {
    const seedId = seeds[i].id;
    for (const row of rows) {
      if (row.id === seedId) continue;
      const existing = neighbours.get(row.id);
      if (!existing || row.hops < existing.row.hops) {
        neighbours.set(row.id, { row, seedId });
      }
    }
  });

  // Keep the nearest neighbours for legibility.
  const trimmed = [...neighbours.entries()]
    .sort((a, b) => a[1].row.hops - b[1].row.hops)
    .slice(0, MAX_NEIGHBOURS);
  return { seeds, neighbours: new Map(trimmed) };
}

/**
 * Render the symbol overlay as a constellation anchored on the file node:
 * seed symbols on an inner ring, reachable symbols on rings by hop distance.
 * Positions are set explicitly — NO relayout — so the base map never jumps.
 */
export function renderSymbolOverlay(cy: Core, filePath: string, overlay: SymbolOverlay): void {
  const anchor = cy.getElementById(filePath);
  if (anchor.empty()) return;
  const { x, y } = anchor.position();

  const added: ElementDefinition[] = [];
  const place = (items: { id: string; label: string; hop: number; size: number }[]) => {
    const n = items.length;
    items.forEach((it, i) => {
      const radius = 64 + it.hop * 58;
      const angle = (i / Math.max(1, n)) * Math.PI * 2 + it.hop * 0.6;
      // Amber, faded with hop distance so nearer symbols read as stronger.
      const alpha = Math.max(0.35, 1 - it.hop * 0.13);
      added.push({
        data: {
          id: it.id,
          type: "symbol",
          label: it.label,
          size: it.size,
          fill: `rgba(240, 168, 37, ${alpha.toFixed(2)})`,
        },
        position: { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius },
        selectable: true,
        grabbable: false,
      });
    });
  };

  place(overlay.seeds.map((s) => ({ id: s.id, label: s.name, hop: 0, size: 18 })));
  place(
    [...overlay.neighbours.values()].map((v) => ({
      id: v.row.id,
      label: v.row.name,
      hop: v.row.hops,
      size: 13,
    })),
  );

  // Edges: file → each seed (contains); seed → each reachable neighbour.
  const seedIds = new Set(overlay.seeds.map((s) => s.id));
  for (const s of overlay.seeds) {
    added.push({
      data: { id: `ov:${filePath}->${s.id}`, source: filePath, target: s.id },
      classes: "overlay",
    });
  }
  for (const { row, seedId } of overlay.neighbours.values()) {
    const src = seedIds.has(seedId) ? seedId : filePath;
    added.push({
      data: { id: `ov:${src}->${row.id}`, source: src, target: row.id },
      classes: "overlay",
    });
  }

  cy.batch(() => {
    // Add symbol nodes as un-dimmed on top of the dimmed base.
    cy.add(added);
  });
}
