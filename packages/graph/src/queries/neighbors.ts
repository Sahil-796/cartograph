import { z } from "zod";
import { defineQuery } from "./types.js";

/**
 * Symbols reachable from (or reaching) a given Symbol via CALLS, up to
 * `depth` hops in direction `dir`.
 *
 * Cypher gotcha: a parameter cannot sit inside a variable-length bound
 * (`[:CALLS*1..$depth]` is a syntax error). We use a fixed generous
 * ceiling of 5 hops and filter `length(p) <= $depth` instead — still
 * fully parameterised, no string concatenation.
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
CALL {
  WITH start
  WHERE $dir = "out" OR $dir = "both"
  MATCH p = (start)-[:CALLS*1..5]->(n:Symbol {repoId: $repoId})
  WHERE length(p) <= $depth
  RETURN n AS neighbor, length(p) AS hops
  UNION ALL
  WITH start
  WHERE $dir = "in" OR $dir = "both"
  MATCH p = (start)<-[:CALLS*1..5]-(n:Symbol {repoId: $repoId})
  WHERE length(p) <= $depth
  RETURN n AS neighbor, length(p) AS hops
}
WITH neighbor, min(hops) AS minHops
RETURN neighbor.id AS id, neighbor.name AS name, neighbor.path AS path, minHops AS hops
ORDER BY minHops ASC
LIMIT 100
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
  cypher,
  map: (records) =>
    records.map((rec) => ({
      id: rec.get("id") as string,
      name: rec.get("name") as string,
      path: rec.get("path") as string,
      hops: (rec.get("hops") as { toNumber: () => number }).toNumber(),
    })),
});
