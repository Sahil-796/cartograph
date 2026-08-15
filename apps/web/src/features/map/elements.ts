/**
 * Turn raw `file_graph` + `file_metrics` rows into cytoscape elements:
 *   - a nested COMPOUND (parent) node per directory that actually contains a
 *     visible file, plus its ancestor chain — fcose lays these out as clusters;
 *   - a file node per non-generated file, sized by `loc`, carrying its joined
 *     metrics as data so colour modes can recolour without refetching;
 *   - the top-N file→file import edges by weight (isolated files are dropped so
 *     the map reads as structure, not confetti).
 */

import type { ElementDefinition } from "cytoscape";
import type { FileGraphRow, FileMetricsRow, FileNodeDatum } from "./types";

export interface BuildOptions {
  /** Hide files flagged `isGenerated` (recommended). */
  hideGenerated: boolean;
  /** Keep at most this many import edges, ranked by weight desc. */
  maxEdges: number;
}

export interface BuiltGraph {
  elements: ElementDefinition[];
  /** Joined file data keyed by path (drives recolouring + focus). */
  fileData: Map<string, FileNodeDatum>;
  /** Adjacency over the VISIBLE import edges (undirected, for BFS focus). */
  adjacency: Map<string, Set<string>>;
  /** Distinct owners / top-level dirs present among visible files (for legend). */
  present: { owners: string[]; dirs: string[] };
  /** Count of visible file nodes (0 ⇒ empty state). */
  fileCount: number;
}

/** loc → node diameter (px), gently compressed so nodes stay well-proportioned. */
function locToSize(loc: number): number {
  const v = Math.max(0, loc);
  return Math.min(48, Math.max(14, Math.round(14 + Math.sqrt(v) * 1.05)));
}

import { topLevelDir } from "./colours";

export function buildGraph(
  graphRows: FileGraphRow[],
  metricRows: FileMetricsRow[],
  opts: BuildOptions,
): BuiltGraph {
  const metricsByPath = new Map<string, FileMetricsRow>();
  for (const m of metricRows) metricsByPath.set(m.path, m);

  // 1. Collect visible file nodes (join metrics, drop generated).
  const fileData = new Map<string, FileNodeDatum>();
  for (const row of graphRows) {
    if (row.kind !== "node") continue;
    if (opts.hideGenerated && row.isGenerated) continue;
    const m = metricsByPath.get(row.path);
    fileData.set(row.path, {
      path: row.path,
      ext: row.ext,
      loc: row.loc,
      isTest: row.isTest,
      isGenerated: row.isGenerated,
      ownerName: m?.ownerName ?? null,
      lastCommitAt: m?.lastCommitAt ?? null,
      busFactor: m?.busFactor ?? 0,
      coveredByTest: m?.coveredByTest ?? false,
    });
  }

  // 2. Rank edges by weight; keep the top-N whose endpoints are both visible.
  const edges = graphRows
    .filter((r): r is Extract<FileGraphRow, { kind: "edge" }> => r.kind === "edge")
    .filter((e) => fileData.has(e.fromPath) && fileData.has(e.toPath) && e.fromPath !== e.toPath)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, opts.maxEdges);

  // 3. Which files survive: only those touched by a kept edge (drop isolates).
  const connected = new Set<string>();
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a)!.add(b);
  };
  for (const e of edges) {
    connected.add(e.fromPath);
    connected.add(e.toPath);
    link(e.fromPath, e.toPath);
    link(e.toPath, e.fromPath);
  }

  // 4. File nodes (pure graph, no rectangular container boxes).
  const owners = new Set<string>();
  const topDirs = new Set<string>();
  const elements: ElementDefinition[] = [];

  for (const path of connected) {
    const f = fileData.get(path)!;
    if (f.ownerName) owners.add(f.ownerName);
    topDirs.add(topLevelDir(path));
    elements.push({
      data: {
        id: path,
        type: "file",
        label: path.slice(path.lastIndexOf("/") + 1),
        size: locToSize(f.loc),
        fill: "#5b5b66", // recoloured immediately after mount
        isTest: f.isTest,
      },
    });
  }

  // 5. Edges.
  for (const e of edges) {
    elements.push({
      data: {
        id: `e:${e.fromPath}->${e.toPath}`,
        source: e.fromPath,
        target: e.toPath,
        weight: e.weight,
      },
    });
  }

  return {
    elements,
    fileData,
    adjacency,
    present: {
      owners: [...owners].sort(),
      dirs: [...topDirs].sort(),
    },
    fileCount: connected.size,
  };
}
