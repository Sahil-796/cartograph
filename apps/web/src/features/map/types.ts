/**
 * LOCAL row types for the queries the map consumes. These mirror the shapes
 * returned by the Unit E queries (`file_graph`, `file_metrics`, `neighbors`,
 * `search`) so the map can stay decoupled from `lib/queries.ts` — we call the
 * queries by name through `runQuery<T>` and type the rows here.
 */

/** A row from `file_graph` — a discriminated union of nodes and edges. */
export type FileGraphRow =
  | {
      kind: "node";
      path: string;
      ext: string;
      loc: number;
      isTest: boolean;
      isGenerated: boolean;
    }
  | {
      kind: "edge";
      fromPath: string;
      toPath: string;
      weight: number;
    };

/** A row from `file_metrics` — one per file, joined to nodes by `path`. */
export interface FileMetricsRow {
  path: string;
  ownerName: string | null;
  /** epoch SECONDS of the most recent commit that changed the file. */
  lastCommitAt: number | null;
  busFactor: number;
  coveredByTest: boolean;
}

/** A row from `neighbors` — a symbol reachable within `hops` call-hops. */
export interface NeighborsRow {
  id: string;
  name: string;
  path: string;
  hops: number;
}

/** A row from `search` — unified file/symbol/entrypoint hit. */
export interface SearchRow {
  type: "file" | "symbol" | "entrypoint";
  id: string;
  name: string;
  path: string;
}

/** Everything the map needs about one file, after joining graph + metrics. */
export interface FileNodeDatum {
  path: string;
  ext: string;
  loc: number;
  isTest: boolean;
  isGenerated: boolean;
  ownerName: string | null;
  lastCommitAt: number | null;
  busFactor: number;
  coveredByTest: boolean;
}
