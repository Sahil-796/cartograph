/**
 * The cytoscape stylesheet. Canvas colours can't read CSS custom properties,
 * so the few chrome colours here are hand-matched to `styles/tokens.css`
 * (near-black ground, amber accent, muted borders). DATA colours never live
 * here — file fill comes from `data(fill)`, set per colour mode in JS.
 */

import type { StylesheetStyle } from "cytoscape";

/** Amber accent, matched to `--primary`. */
export const AMBER = "#f0a825";
const AMBER_SOFT = "rgba(240, 168, 37, 0.55)";
const EDGE = "rgba(150, 150, 165, 0.22)";
const DIR_BORDER = "rgba(150, 150, 165, 0.16)";
const DIR_LABEL = "rgba(220, 220, 228, 0.34)";
const FILE_LABEL = "rgba(232, 232, 238, 0.9)";

export function mapStylesheet(): StylesheetStyle[] {
  return [
    // ---- directory compounds ----
    {
      selector: 'node[type="dir"]',
      style: {
        "background-opacity": 0.04,
        "background-color": "#ffffff",
        "border-width": 1,
        "border-color": DIR_BORDER,
        "border-style": "dashed",
        shape: "round-rectangle",
        "corner-radius": "10",
        label: "data(label)",
        "font-size": 11,
        color: DIR_LABEL,
        "text-valign": "top",
        "text-halign": "center",
        "text-margin-y": -2,
        "min-zoomed-font-size": 9,
        padding: "14px",
        "text-transform": "none",
      },
    },
    // ---- file nodes ----
    {
      selector: 'node[type="file"]',
      style: {
        width: "data(size)",
        height: "data(size)",
        "background-color": "data(fill)",
        "border-width": 1,
        "border-color": "rgba(0,0,0,0.45)",
        shape: "ellipse",
        label: "",
        "font-size": 10,
        color: FILE_LABEL,
        "text-valign": "bottom",
        "text-halign": "center",
        "text-margin-y": 2,
        "text-outline-width": 2,
        "text-outline-color": "#141414",
        "min-zoomed-font-size": 11,
        "transition-property": "opacity, border-width, border-color",
        "transition-duration": 180,
      },
    },
    {
      selector: 'node[type="file"][?isTest]',
      style: { shape: "round-diamond" },
    },
    // ---- symbol overlay nodes (focus/depth neighbourhood) ----
    {
      selector: 'node[type="symbol"]',
      style: {
        width: "data(size)",
        height: "data(size)",
        "background-color": "data(fill)",
        "border-width": 1,
        "border-color": AMBER,
        shape: "ellipse",
        label: "data(label)",
        "font-size": 9,
        color: FILE_LABEL,
        "text-valign": "center",
        "text-halign": "right",
        "text-margin-x": 3,
        "text-outline-width": 2,
        "text-outline-color": "#141414",
        "min-zoomed-font-size": 8,
        "z-index": 30,
      },
    },
    // ---- edges ----
    {
      selector: "edge",
      style: {
        width: "mapData(weight, 1, 6, 0.6, 2.4)",
        "line-color": EDGE,
        "curve-style": "straight",
        opacity: 0.9,
        "transition-property": "opacity, line-color, width",
        "transition-duration": 180,
      },
    },
    {
      selector: "edge.overlay",
      style: {
        "line-color": AMBER_SOFT,
        "line-style": "dashed",
        width: 1.2,
        "target-arrow-color": AMBER_SOFT,
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.7,
        "curve-style": "bezier",
        "z-index": 25,
      },
    },
    // ---- interaction / focus states ----
    {
      selector: "node.hover",
      style: { "border-width": 2, "border-color": AMBER },
    },
    {
      selector: 'node[type="file"].selected',
      style: {
        "border-width": 3,
        "border-color": AMBER,
        label: "data(label)",
        "z-index": 40,
      },
    },
    {
      selector: 'node[type="file"].neighbour',
      style: {
        "border-width": 2,
        "border-color": AMBER_SOFT,
        label: "data(label)",
        "z-index": 20,
      },
    },
    {
      selector: "edge.neighbour",
      style: { "line-color": AMBER_SOFT, opacity: 1, width: 1.6, "z-index": 15 },
    },
    // dimming everything outside the focus set
    {
      selector: "node.dim",
      style: { opacity: 0.1 },
    },
    {
      selector: "edge.dim",
      style: { opacity: 0.03 },
    },
    {
      selector: 'node[type="dir"].dim',
      style: { opacity: 0.25 },
    },
  ];
}
