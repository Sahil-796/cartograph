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
const FILE_LABEL = "rgba(232, 232, 238, 0.9)";

export function mapStylesheet(): StylesheetStyle[] {
  return [
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
        "border-width": 1.5,
        "border-color": AMBER,
        shape: "ellipse",
        label: "data(label)",
        "font-size": 10,
        color: FILE_LABEL,
        "text-valign": "center",
        "text-halign": "right",
        "text-margin-x": 4,
        "text-outline-width": 2,
        "text-outline-color": "#121215",
        "min-zoomed-font-size": 8,
        "z-index": 30,
      },
    },
    // ---- edges ----
    {
      selector: "edge",
      style: {
        width: "mapData(weight, 1, 6, 0.6, 2.2)",
        "line-color": EDGE,
        "curve-style": "straight",
        opacity: 0.35,
        "transition-property": "opacity, line-color, width",
        "transition-duration": 180,
      },
    },
    {
      selector: "edge.overlay",
      style: {
        "line-color": AMBER_SOFT,
        "line-style": "dashed",
        width: 1.5,
        "target-arrow-color": AMBER_SOFT,
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.75,
        "curve-style": "bezier",
        "z-index": 25,
      },
    },
    // ---- interaction / focus states ----
    {
      selector: "node.hover",
      style: {
        "border-width": 2,
        "border-color": "#ffffff",
        label: "data(label)",
        "font-size": 10,
        color: "#ffffff",
        "text-outline-width": 2,
        "text-outline-color": "#101014",
        "z-index": 45,
      },
    },
    {
      selector: "edge.hover",
      style: {
        "line-color": "rgba(255, 255, 255, 0.6)",
        opacity: 0.85,
        width: 1.8,
        "z-index": 20,
      },
    },
    {
      selector: "node.selected",
      style: {
        "border-width": 2.5,
        "border-color": "#ffffff",
        "outline-width": 2,
        "outline-color": "rgba(255, 255, 255, 0.25)",
        "outline-opacity": 1,
        label: "data(label)",
        "font-size": 11,
        "font-weight": "bold",
        color: "#ffffff",
        "text-valign": "bottom",
        "text-margin-y": 4,
        "text-outline-width": 2.5,
        "text-outline-color": "#0d0d10",
        "min-zoomed-font-size": 0, // Always visible on canvas
        "z-index": 100,
      },
    },
    {
      selector: "node.neighbour",
      style: {
        "border-width": 1.5,
        "border-color": "rgba(255, 255, 255, 0.55)",
        label: "data(label)",
        "font-size": 9.5,
        color: "rgba(235, 235, 240, 0.9)",
        "text-valign": "bottom",
        "text-margin-y": 3,
        "text-outline-width": 2,
        "text-outline-color": "#101014",
        "z-index": 30,
      },
    },
    {
      selector: "edge.neighbour",
      style: {
        "line-color": "rgba(255, 255, 255, 0.55)",
        opacity: 0.85,
        width: 1.8,
        "z-index": 25,
      },
    },
    // dimming everything outside the focus set
    {
      selector: "node.dim",
      style: { opacity: 0.15 },
    },
    {
      selector: "edge.dim",
      style: { opacity: 0.03 },
    },
  ];
}
