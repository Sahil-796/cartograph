/**
 * Typed wrappers around the 9 graph queries.
 *
 * Each row interface mirrors the corresponding row type in
 * `packages/graph/src/queries/*.ts` (the backend's source of truth). They are
 * duplicated here rather than imported because the web app does not depend on
 * the graph package at build time — keep them in sync if the graph rows change.
 *
 * Every wrapper is a thin, named call over `runQuery` so feature code reads as
 * `search(repoId, term)` instead of stringly-typed `runQuery("search", {...})`.
 * Params with server-side zod defaults are optional here too.
 */

import { runQuery } from "./api";

/* ------------------------------------------------------------------ *
 * Row types (mirror packages/graph/src/queries/*.ts)
 * ------------------------------------------------------------------ */

export interface SearchRow {
  type: "file" | "symbol" | "entrypoint";
  id: string;
  name: string;
  path: string;
}

export interface NeighborsRow {
  id: string;
  name: string;
  path: string;
  hops: number;
}

export interface PathRow {
  id: string;
  name: string;
  path: string;
}

export interface WhoTouchedRow {
  name: string;
  email: string;
  weight: number;
  files: number;
  lastTouch: number;
}

export interface BusFactorAuthor {
  name: string;
  email: string;
  weight: number;
  share: number;
}

export interface BusFactorRow {
  busFactor: number;
  contributors: BusFactorAuthor[];
}

export interface CoChangedRow {
  path: string;
  count: number;
  strength: number;
}

export interface HiddenCouplingRow {
  a: string;
  b: string;
  count: number;
  strength: number;
}

export interface CyclesRow {
  cycle: string[];
}

export interface EntrypointsRow {
  method: string | null;
  path: string;
  handler: string | null;
}

/* ------------------------------------------------------------------ *
 * Param option types (optional fields carry server-side defaults)
 * ------------------------------------------------------------------ */

export type NodeKind = SearchRow["type"];
export type Direction = "out" | "in" | "both";

export interface SearchOpts {
  kinds?: NodeKind[];
}
export interface NeighborsOpts {
  depth?: number; // 1..5, default 2
  dir?: Direction; // default "both"
}
export interface WhoTouchedOpts {
  halfLifeDays?: number; // default 180
  includeBots?: boolean; // default false
  now?: number; // epoch seconds, default now
}
export interface BusFactorOpts {
  halfLifeDays?: number; // default 180
  now?: number; // epoch seconds, default now
}

/* ------------------------------------------------------------------ *
 * Thin typed wrappers
 * ------------------------------------------------------------------ */

/** Free-text search across files, symbols and entrypoints by name/path. */
export function search(
  repoId: string,
  term: string,
  opts: SearchOpts = {},
  signal?: AbortSignal,
): Promise<SearchRow[]> {
  return runQuery<SearchRow>("search", { repoId, term, ...opts }, signal);
}

/** Symbols reachable from / to a symbol via CALLS, up to `depth` hops. */
export function neighbors(
  repoId: string,
  nodeId: string,
  opts: NeighborsOpts = {},
  signal?: AbortSignal,
): Promise<NeighborsRow[]> {
  return runQuery<NeighborsRow>("neighbors", { repoId, nodeId, ...opts }, signal);
}

/** Shortest call path between two symbols (ordered nodes, empty if none). */
export function path(
  repoId: string,
  fromId: string,
  toId: string,
  signal?: AbortSignal,
): Promise<PathRow[]> {
  return runQuery<PathRow>("path", { repoId, fromId, toId }, signal);
}

/** Ranked authors by time-decayed contribution to files under `scope`. */
export function whoTouched(
  repoId: string,
  scope: string,
  opts: WhoTouchedOpts = {},
  signal?: AbortSignal,
): Promise<WhoTouchedRow[]> {
  return runQuery<WhoTouchedRow>("who_touched", { repoId, scope, ...opts }, signal);
}

/** Truck factor for a path scope (returns a single-element array). */
export function busFactor(
  repoId: string,
  scope: string,
  opts: BusFactorOpts = {},
  signal?: AbortSignal,
): Promise<BusFactorRow[]> {
  return runQuery<BusFactorRow>("bus_factor", { repoId, scope, ...opts }, signal);
}

/** Files that historically co-change with `fileId`, ranked by strength. */
export function coChanged(
  repoId: string,
  fileId: string,
  minCount = 3,
  signal?: AbortSignal,
): Promise<CoChangedRow[]> {
  return runQuery<CoChangedRow>("co_changed", { repoId, fileId, minCount }, signal);
}

/** Co-change pairs with no import path within 4 hops (the headline query). */
export function hiddenCoupling(
  repoId: string,
  opts: { minCount?: number; limit?: number } = {},
  signal?: AbortSignal,
): Promise<HiddenCouplingRow[]> {
  return runQuery<HiddenCouplingRow>("hidden_coupling", { repoId, ...opts }, signal);
}

/** Import cycles: chains of files that import each other back into a loop. */
export function cycles(
  repoId: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<CyclesRow[]> {
  return runQuery<CyclesRow>("cycles", { repoId, limit }, signal);
}

/** All entrypoints (routes/handlers) with their handler symbol name. */
export function entrypoints(
  repoId: string,
  signal?: AbortSignal,
): Promise<EntrypointsRow[]> {
  return runQuery<EntrypointsRow>("entrypoints", { repoId }, signal);
}
