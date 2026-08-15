/**
 * Chat citation highlight — the small, additive bridge between the chat
 * panel and the map (Phase 5 / Unit C). `MapView` calls `applyHighlight` on
 * every change to `repoStore.highlightedNodes`; it rings whatever nodes
 * actually exist on the current canvas and is a silent no-op for the rest —
 * e.g. `author` citations never have a map node, and `symbol` citations only
 * resolve when that file's symbol overlay happens to be rendered.
 */

import type { Core } from "cytoscape";
import type { HighlightedNode } from "../../state/repoStore";

/** Ring the nodes matching `nodes` with the `.cg-highlight` class (see
 * `style.ts`); clears any previous highlight first, cheaply, as one batch. */
export function applyHighlight(cy: Core, nodes: HighlightedNode[]): void {
  cy.batch(() => {
    cy.elements(".cg-highlight").removeClass("cg-highlight");
    for (const n of nodes) {
      if (n.kind === "author") continue; // no map representation for authors
      const el = cy.getElementById(n.ref);
      if (el.nonempty()) el.addClass("cg-highlight");
    }
  });
}
