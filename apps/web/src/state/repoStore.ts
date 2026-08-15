/**
 * Shared RepoView store (zustand).
 *
 * This is the contract between the two halves of the `/r/:repoId` screen:
 *   - the MAP (`features/map/MapView`) WRITES `selectedNodeId` when a node is
 *     clicked and READS `colourMode` / `depth` to render;
 *   - the SIDE PANEL (`features/panel/SidePanel`) READS `selectedNodeId` to
 *     decide what to fetch/show, and READS/WRITES `panelOpen` / `panelTab`;
 *   - the ⌘K PALETTE (`features/search/CommandPalette`) WRITES
 *     `selectedNodeId` (and may open the panel) when a result is chosen.
 *   - the CHAT PANEL (`features/chat/ChatPanel`) WRITES `highlightedNodes`
 *     when a citation chip is clicked; the MAP reads it to ring the matching
 *     nodes without disturbing the existing selection/focus state.
 *
 * Feature agents CONSUME this store but never edit this file — the shape below
 * is the frozen contract. Each field is documented so a feature can be built
 * against it without reading the rest of the app.
 *
 * Note: this store is intentionally repo-agnostic (it holds view state, not
 * the repoId — that lives in the route). Call `reset()` when the repo changes
 * so selection/panel state from a previous repo doesn't leak across.
 */

import { create } from "zustand";

/** How the map colours nodes. Drives both the map render and the legend. */
export type ColourMode =
  | "owner" // dominant author (who_touched)
  | "recency" // last-touched, decayed
  | "busFactor" // single-point-of-failure risk (bus_factor)
  | "coverage" // test coverage, if available
  | "directory"; // top-level directory bucket

/** Which tab the side panel is showing for the selected node. */
export type PanelTab =
  | "overview" // summary of the selected node
  | "neighbors" // call neighbours
  | "coupling" // co-change / hidden coupling
  | "history"; // who_touched / recent commits

export type SelectedNodeKind = "file" | "symbol" | "entrypoint";

/** The kind of graph entity a chat citation points at. Mirrors
 * `features/chat/types.ts#CitationNode` — kept structurally compatible
 * rather than imported, so this frozen store never depends on a feature. */
export type HighlightedNodeKind = "file" | "author" | "symbol";

/** One node referenced by a clicked citation chip. `ref` is a file path,
 * author name, or `"path#name"` symbol ref — whatever the map can look up. */
export interface HighlightedNode {
  kind: HighlightedNodeKind;
  ref: string;
}

export interface RepoState {
  /**
   * The currently selected graph node id, or `null` when nothing is selected.
   * For symbols this is the symbol `id`; for files it is the file `path`
   * (matching the `id` field returned by the `search` query). The side panel
   * keys all of its fetches off this value.
   */
  selectedNodeId: string | null;

  /** Entity kind of the active selection, so file-only detail queries are
   * never run with a symbol or route id. */
  selectedNodeKind: SelectedNodeKind | null;

  /** Active map colouring. Written by the map's legend/controls. */
  colourMode: ColourMode;

  /** Neighbour-expansion depth for the map, 1–5 (clamped by `setDepth`). */
  depth: number;

  /** Whether the side panel is expanded. */
  panelOpen: boolean;

  /** The side panel's active tab. */
  panelTab: PanelTab;

  /**
   * Nodes to ring on the map, set by clicking a chat citation chip. Empty
   * when nothing is highlighted. Independent of `selectedNodeId` — clicking a
   * chip highlights without stealing the current selection/focus.
   */
  highlightedNodes: HighlightedNode[];

  // ---- setters ----

  /**
   * Select a node (or clear with `null`). Selecting a non-null node also
   * opens the panel, so a map click / palette pick reveals the detail pane in
   * one action.
   */
  setSelectedNodeId: (id: string | null, kind?: SelectedNodeKind) => void;

  /** Change the map colour mode. */
  setColourMode: (mode: ColourMode) => void;

  /** Set neighbour depth; values are clamped to the 1–5 range. */
  setDepth: (depth: number) => void;

  /** Explicitly open/close the panel. */
  setPanelOpen: (open: boolean) => void;

  /** Switch the panel's active tab. */
  setPanelTab: (tab: PanelTab) => void;

  /** Set the nodes a clicked citation chip points at (replaces any prior set). */
  highlightNodes: (nodes: HighlightedNode[]) => void;

  /** Clear the citation highlight. */
  clearHighlight: () => void;

  /** Reset all view state to defaults — call on repo change. */
  reset: () => void;
}

const INITIAL: Pick<
  RepoState,
  "selectedNodeId" | "selectedNodeKind" | "colourMode" | "depth" | "panelOpen" | "panelTab" | "highlightedNodes"
> = {
  selectedNodeId: null,
  selectedNodeKind: null,
  colourMode: "owner",
  depth: 2,
  panelOpen: false,
  panelTab: "overview",
  highlightedNodes: [],
};

const clampDepth = (d: number): number =>
  Math.max(1, Math.min(5, Math.round(d)));

export const useRepoStore = create<RepoState>((set) => ({
  ...INITIAL,

  setSelectedNodeId: (id, kind = "file") =>
    set((s) => ({
      selectedNodeId: id,
      selectedNodeKind: id === null ? null : kind,
      // Reveal the panel whenever a node is actually selected.
      panelOpen: id !== null ? true : s.panelOpen,
    })),

  setColourMode: (mode) => set({ colourMode: mode }),

  setDepth: (depth) => set({ depth: clampDepth(depth) }),

  setPanelOpen: (open) => set({ panelOpen: open }),

  setPanelTab: (tab) => set({ panelTab: tab }),

  highlightNodes: (nodes) => set({ highlightedNodes: nodes }),

  clearHighlight: () => set({ highlightedNodes: [] }),

  reset: () => set({ ...INITIAL }),
}));
