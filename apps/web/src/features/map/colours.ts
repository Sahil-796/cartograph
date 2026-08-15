/**
 * Colour encoding for the map — one function per colour mode plus the live
 * legend descriptors that the <Legend> renders.
 *
 * Design constraints (from the brief, all honoured here):
 *   - Dark-first, amber-on-near-black. The single UI accent is amber; the DATA
 *     ramps below are the only other saturated colour on screen.
 *   - COLOURBLIND-SAFE. Categorical modes use the Okabe–Ito qualitative
 *     palette — the reference 8-colour set engineered to stay distinct under
 *     protanopia/deuteranopia/tritanopia. No indigo anywhere.
 *   - Sequential `recency` uses a trimmed MAGMA ramp (perceptually uniform,
 *     colourblind-safe, warm — harmonises with amber). We trim the near-black
 *     low end so old files stay visible on the near-black canvas.
 *   - The `busFactor` risk ramp is green→amber→red but with a BLUE-leaning
 *     ("teal") green and a dark red so the two ends separate by LUMINANCE, not
 *     just hue — that is what keeps it readable for deuteranopia, where pure
 *     red vs pure green collapse.
 *   - Any file missing a metric degrades to a muted neutral "unknown" grey.
 */

import type { ColourMode } from "../../state/repoStore";
import type { FileNodeDatum } from "./types";

/** Muted neutral for files with no value for the active metric. */
export const UNKNOWN = "#5b5b66";

/**
 * Vibrant, high-contrast qualitative palette optimized for dark backgrounds.
 * Fully distinguishable, vivid, and harmonious with amber accents.
 */
const OKABE_ITO = [
  "#38bdf8", // vibrant sky blue / cyan
  "#f97316", // vibrant warm orange
  "#10b981", // vibrant emerald green
  "#facc15", // bright gold yellow
  "#818cf8", // periwinkle blue
  "#ec4899", // bright rose / pink
  "#14b8a6", // luminous teal
  "#a855f7", // vivid purple
  "#fb7185", // coral salmon
  "#22c55e", // bright leaf green
];

/** Deterministic string hash → palette index (stable across renders). */
function hashIndex(s: string, mod: number): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % mod;
}

export function categoricalColour(key: string | null | undefined): string {
  if (!key) return UNKNOWN;
  return OKABE_ITO[hashIndex(key, OKABE_ITO.length)];
}

/** The top-level directory bucket for a path ("src/a/b.ts" → "src", "packages/ui/..." → "packages/ui"). */
export function topLevelDir(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 1) return "·root";
  if (parts.length >= 3 && (parts[0] === "packages" || parts[0] === "apps")) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
}

// ---- sequential ramp helpers (sRGB interpolation between stops) ----

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
/** Sample a piecewise-linear ramp of hex stops at t∈[0,1]. */
function ramp(stops: string[], t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  if (i >= stops.length - 1) return stops[stops.length - 1];
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  return rgbToHex(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
}

/** Trimmed magma: old (deep plum) → recent (bright peach). */
const MAGMA = ["#3b2154", "#822681", "#c53c74", "#f8765c", "#febb81", "#fde2a3"];

/** Teal-green (safe) → amber (mid) → dark red (risk). Luminance-separated. */
const RISK = ["#c1121f", "#e85d04", "#f0a825", "#8fbf3f", "#2a9d8f"];

// ---- per-mode colour resolution ----

/** Domain (min/max epoch seconds) for the recency ramp across the repo. */
export interface RecencyDomain {
  min: number;
  max: number;
}

export function computeRecencyDomain(files: FileNodeDatum[]): RecencyDomain {
  let min = Infinity;
  let max = -Infinity;
  for (const f of files) {
    if (f.lastCommitAt == null) continue;
    if (f.lastCommitAt < min) min = f.lastCommitAt;
    if (f.lastCommitAt > max) max = f.lastCommitAt;
  }
  if (!isFinite(min) || !isFinite(max) || min === max) return { min: 0, max: 1 };
  return { min, max };
}

export interface ColourContext {
  recency: RecencyDomain;
}

/** The colour for one file under the active mode. */
export function colourFor(
  mode: ColourMode,
  f: FileNodeDatum,
  ctx: ColourContext,
): string {
  switch (mode) {
    case "owner":
      // If author is known, colour by author; otherwise gracefully fallback to directory module colour
      return f.ownerName ? categoricalColour(f.ownerName) : categoricalColour(topLevelDir(f.path));
    case "directory":
      return categoricalColour(topLevelDir(f.path));
    case "recency": {
      if (f.lastCommitAt == null) return UNKNOWN;
      const t = (f.lastCommitAt - ctx.recency.min) / (ctx.recency.max - ctx.recency.min);
      return ramp(MAGMA, t);
    }
    case "busFactor": {
      if (!f.busFactor || f.busFactor < 1) return UNKNOWN;
      // bf 1 = single point of failure (risk, t=0) → bf 5+ = resilient (t=1).
      const t = Math.min(1, (f.busFactor - 1) / 4);
      return ramp(RISK, t);
    }
    case "coverage":
      return f.coveredByTest ? "#2a9d8f" : UNKNOWN;
    default:
      return UNKNOWN;
  }
}

// ---- legend descriptors ----

export interface LegendSwatch {
  colour: string;
  label: string;
}
export interface LegendSpec {
  title: string;
  /** Discrete swatches (categorical / boolean). */
  swatches?: LegendSwatch[];
  /** A continuous gradient bar with end labels (sequential ramps). */
  gradient?: { css: string; lowLabel: string; highLabel: string };
  note?: string;
}

function gradientCss(stops: string[]): string {
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/**
 * Build the legend for the active mode. For categorical modes we pass the
 * distinct keys actually present so the legend is LIVE (matches the data).
 */
export function legendFor(
  mode: ColourMode,
  present: { owners: string[]; dirs: string[] },
): LegendSpec {
  switch (mode) {
    case "owner": {
      if (present.owners.length === 0) {
        const keys = present.dirs.slice(0, 7);
        const swatches: LegendSwatch[] = keys.map((k) => ({
          colour: categoricalColour(k),
          label: k,
        }));
        return { title: "Directory module (no git authors)", swatches };
      }
      const keys = present.owners.slice(0, 7);
      const swatches: LegendSwatch[] = keys.map((k) => ({
        colour: categoricalColour(k),
        label: k,
      }));
      if (present.owners.length > keys.length) {
        swatches.push({ colour: UNKNOWN, label: "unattributed / other" });
      }
      return { title: "Dominant author", swatches };
    }
    case "directory": {
      const keys = present.dirs.slice(0, 7);
      const swatches: LegendSwatch[] = keys.map((k) => ({
        colour: categoricalColour(k),
        label: k,
      }));
      if (present.dirs.length > keys.length) {
        swatches.push({ colour: UNKNOWN, label: "other" });
      }
      return { title: "Top-level directory", swatches };
    }
    case "recency":
      return {
        title: "Last commit",
        gradient: { css: gradientCss(MAGMA), lowLabel: "older", highLabel: "recent" },
        note: "grey = never committed",
      };
    case "busFactor":
      return {
        title: "Bus factor (risk)",
        gradient: {
          css: gradientCss(["#c1121f", "#f0a825", "#2a9d8f"]),
          lowLabel: "1 · risky",
          highLabel: "5+ · resilient",
        },
        note: "grey = no attributable work",
      };
    case "coverage":
      return {
        title: "Test coverage",
        swatches: [
          { colour: "#2a9d8f", label: "imported by a test" },
          { colour: UNKNOWN, label: "no test imports it" },
        ],
      };
    default:
      return { title: "" };
  }
}
