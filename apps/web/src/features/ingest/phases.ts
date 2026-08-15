/**
 * Display metadata for the ingest stepper — the ordered, user-visible phases
 * and the copy/count-key shown for each. `"queued"` and `"failed"` are not
 * steps in the checklist (queued is the pre-step waiting state; failed
 * replaces the whole panel with a rejection/error view).
 */

import type { IngestCounts, IngestPhase } from "./types";

export interface PhaseStep {
  phase: IngestPhase;
  label: string;
  detail: string;
  /** Which `IngestCounts` keys this phase's count chip should read, in order. */
  countKeys?: (keyof IngestCounts)[];
}

export const PHASE_STEPS: PhaseStep[] = [
  { phase: "precheck", label: "Precheck", detail: "Validating the repository" },
  { phase: "cloning", label: "Cloning", detail: "Fetching the repository" },
  { phase: "parsing", label: "Parsing", detail: "Reading files and symbols", countKeys: ["files", "symbols"] },
  { phase: "linking", label: "Linking", detail: "Resolving references between symbols", countKeys: ["edges"] },
  { phase: "history", label: "History", detail: "Walking commits and authors", countKeys: ["commits"] },
  { phase: "writing", label: "Writing", detail: "Writing the graph to CognoDB", countKeys: ["nodes", "edges"] },
  { phase: "ready", label: "Ready", detail: "Graph is ready to explore" },
];

const ORDER: IngestPhase[] = ["queued", ...PHASE_STEPS.map((s) => s.phase)];

/** Index of `phase` in the overall ordering (queued=0 … ready=7, failed=-1). */
export function phaseIndex(phase: IngestPhase | null): number {
  if (!phase) return -1;
  return ORDER.indexOf(phase);
}

const COUNT_LABELS: Record<keyof IngestCounts, string> = {
  files: "files",
  symbols: "symbols",
  commits: "commits",
  nodes: "nodes",
  edges: "edges",
};

export function formatCount(key: keyof IngestCounts, value: number): string {
  return `${value.toLocaleString()} ${COUNT_LABELS[key]}`;
}
