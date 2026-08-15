import { z } from "zod";
import { defineQuery } from "./types.js";

/**
 * Symbols reachable from (or reaching) a given Symbol via CALLS, up to
 * `depth` hops in direction `dir`.
 *
 * Two CognoDB-specific constraints shape this query:
 *
 *  1. A parameter cannot sit inside a variable-length bound
 *     (`[:CALLS*1..$depth]` is a syntax error). We use a fixed generous
 *     ceiling of 5 hops and filter `length(p) <= $depth` instead — still
 *     fully parameterised, no string concatenation.
 *
 *  2. CognoDB silently drops every row when a parameter-only predicate
 *     (`WHERE $dir = 'out'`) sits inside a `CALL { ... }` subquery, but
 *     evaluates the same predicate correctly at the top level. So the two
 *     directions are expressed as a top-level `UNION` of two guarded
 *     branches rather than a single `CALL`/`UNION ALL` subquery. Each
 *     branch's guard (`$dir = 'out' OR $dir = 'both'`) short-circuits the
 *     whole branch when the direction doesn't apply.
 *
 * A symbol can be reached by more than one path (at different hop counts);
 * `map` keeps the shortest and sorts by it.
 */

const paramsSchema = z.object({
  repoId: z.string(),
  nodeId: z.string(),
  depth: z.number().int().min(1).max(5).default(2),
  dir: z.enum(["out", "in", "both"]).default("both"),
});

export type NeighborsParams = z.infer<typeof paramsSchema>;

export interface NeighborsRow {
  id: string;
  name: string;
  path: string;
  hops: number;
}

const cypher = `
MATCH (start:Symbol {repoId: $repoId, id: $nodeId})
WHERE $dir = "out" OR $dir = "both"
MATCH p = (start)-[:CALLS*1..5]->(n:Symbol {repoId: $repoId})
WHERE length(p) <= $depth
RETURN n.id AS id, n.name AS name, n.path AS path, length(p) AS hops
UNION
MATCH (start:Symbol {repoId: $repoId, id: $nodeId})
WHERE $dir = "in" OR $dir = "both"
MATCH p = (start)<-[:CALLS*1..5]-(n:Symbol {repoId: $repoId})
WHERE length(p) <= $depth
RETURN n.id AS id, n.name AS name, n.path AS path, length(p) AS hops
`;

export const neighbors = defineQuery<NeighborsParams, NeighborsRow>({
  name: "neighbors",
  description:
    "Symbols reachable from (or reaching) a given symbol via call edges, up to a bounded number of hops in a chosen direction.",
  // Cast: zod's Input type for a schema with `.default()` fields
  // (optional on input, required on output) doesn't unify with
  // `ZodType<Params>`'s Input===Output===Params constraint. The runtime
  // contract still holds — `NeighborsParams` (the full, defaulted shape) is
  // always accepted by `paramsSchema.parse(...)`.
  params: paramsSchema as unknown as import("zod").ZodType<NeighborsParams>,
  map: (records) => {
    // A neighbor can appear via several paths; keep the shortest.
    const minHopsById = new Map<string, NeighborsRow>();
    for (const rec of records) {
      const hops = (rec.get("hops") as { toNumber: () => number }).toNumber();
      const id = rec.get("id") as string;
      const existing = minHopsById.get(id);
      if (!existing || hops < existing.hops) {
        minHopsById.set(id, {
          id,
          name: rec.get("name") as string,
          path: rec.get("path") as string,
          hops,
        });
      }
    }
    return [...minHopsById.values()].sort((a, b) => a.hops - b.hops).slice(0, 100);
  },
  cypher,
});
