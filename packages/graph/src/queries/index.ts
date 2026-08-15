import type { QueryDef } from "./types.js";
import { search } from "./search.js";
import { neighbors } from "./neighbors.js";
import { path } from "./path.js";
import { whoTouched } from "./whoTouched.js";
import { busFactor } from "./busFactor.js";
import { coChanged } from "./coChanged.js";
import { hiddenCoupling } from "./hiddenCoupling.js";
import { cycles } from "./cycles.js";
import { entrypoints } from "./entrypoints.js";

export { search } from "./search.js";
export type { SearchParams, SearchRow } from "./search.js";
export { neighbors } from "./neighbors.js";
export type { NeighborsParams, NeighborsRow } from "./neighbors.js";
export { path } from "./path.js";
export type { PathParams, PathRow } from "./path.js";
export { whoTouched } from "./whoTouched.js";
export type { WhoTouchedParams, WhoTouchedRow } from "./whoTouched.js";
export { busFactor } from "./busFactor.js";
export type { BusFactorParams, BusFactorRow, BusFactorAuthor } from "./busFactor.js";
export { coChanged } from "./coChanged.js";
export type { CoChangedParams, CoChangedRow } from "./coChanged.js";
export { hiddenCoupling } from "./hiddenCoupling.js";
export type { HiddenCouplingParams, HiddenCouplingRow } from "./hiddenCoupling.js";
export { cycles } from "./cycles.js";
export type { CyclesParams, CyclesRow } from "./cycles.js";
export { entrypoints } from "./entrypoints.js";
export type { EntrypointsParams, EntrypointsRow } from "./entrypoints.js";

/**
 * The registry: every query the product exposes, indexed by name. This
 * is what the three front doors (REST, chat, MCP) iterate to build their
 * tool lists, and what `getQuery` resolves a caller's requested tool
 * name against.
 */
export const queries: QueryDef[] = [
  search,
  neighbors,
  path,
  whoTouched,
  busFactor,
  coChanged,
  hiddenCoupling,
  cycles,
  entrypoints,
];

/** Looks up a query definition by its `name`. Returns `undefined` if unknown. */
export function getQuery(name: string): QueryDef | undefined {
  return queries.find((q) => q.name === name);
}
