/**
 * Chat citation highlight — the small, additive bridge between the chat
 * panel and the map (Phase 5 / Unit C). `MapView` calls `applyHighlight` on
 * every change to `repoStore.highlightedNodes`; it rings whatever nodes
 * actually exist on the current canvas and is a silent no-op for the rest —
 * e.g. `author` citations never have a map node, and a file that has no import
 * edges is never drawn (the map is the *import* graph), so a co-change / bus
 * factor citation can point at files that simply aren't on screen.
 *
 * Because a matched node is frequently off the current viewport — or only a
 * subset of the citation's nodes is drawn — a bare class toggle *looks* like
 * "nothing happened". So on a non-empty match we also dim everything else and
 * animate the camera to frame the matched set. `applyHighlight` returns how
 * many nodes it actually found on the canvas so the caller can tell the user
 * when a citation maps to nothing here.
 */

import type { Core, NodeCollection } from "cytoscape";
import type { HighlightedNode } from "../../state/repoStore";

/**
 * Ring the nodes matching `nodes`, dim the rest, and pan/zoom to frame the
 * match. Clears any previous highlight first. Returns the count of citation
 * nodes found on the current canvas (0 when none are drawn here).
 */
export function applyHighlight(cy: Core, nodes: HighlightedNode[]): number {
  // Collect the matching on-canvas nodes first so we can decide whether to
  // dim/zoom at all.
  let matched = cy.collection() as NodeCollection;
  for (const n of nodes) {
    if (n.kind === "author") continue; // no map representation for authors
    const el = cy.getElementById(n.ref);
    if (el.nonempty() && el.isNode()) matched = matched.union(el);
  }

  cy.batch(() => {
    cy.elements().removeClass("cg-highlight cg-dim");
    if (matched.nonempty()) {
      // Dim everything, then lift the matched set back to full strength.
      cy.elements().addClass("cg-dim");
      matched.removeClass("cg-dim").addClass("cg-highlight");
      matched.connectedEdges().removeClass("cg-dim");
    }
  });

  if (matched.nonempty()) frame(cy, matched);
  return matched.length;
}

/** Smoothly move the camera to frame `matched`, without zooming in absurdly on
 * a single node. Camera moves are best-effort: `cy.animate` reads the renderer's
 * bounding box and throws if the canvas isn't laid out yet (0×0 container, a
 * torn-down instance mid-HMR), so a failure here must never break the
 * already-applied highlight. */
function frame(cy: Core, matched: NodeCollection): void {
  if (cy.width() === 0 || cy.height() === 0) return; // canvas not laid out — nothing to frame into
  try {
    cy.stop();
    if (matched.length === 1) {
      cy.animate(
        { center: { eles: matched }, zoom: Math.min(1.6, cy.maxZoom()) },
        { duration: 350, easing: "ease-out-cubic" },
      );
    } else {
      cy.animate({ fit: { eles: matched, padding: 90 } }, { duration: 350, easing: "ease-out-cubic" });
    }
  } catch {
    /* renderer not ready — highlight/dim still applied, just no camera move */
  }
}
