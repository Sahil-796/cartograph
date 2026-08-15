import { z } from "zod";
import { defineQuery } from "./types.js";

/**
 * Shortest call path between two Symbols. Returns the ordered node
 * names/paths along the path, or an empty array if no path exists.
 */

const paramsSchema = z.object({
  repoId: z.string(),
  fromId: z.string(),
  toId: z.string(),
});

export type PathParams = z.infer<typeof paramsSchema>;

export interface PathRow {
  id: string;
  name: string;
  path: string;
}

const cypher = `
MATCH (from:Symbol {repoId: $repoId, id: $fromId}), (to:Symbol {repoId: $repoId, id: $toId})
OPTIONAL MATCH p = shortestPath((from)-[:CALLS*1..15]-(to))
WITH CASE WHEN p IS NULL THEN [] ELSE nodes(p) END AS ns
UNWIND ns AS n
RETURN n.id AS id, n.name AS name, n.path AS path
`;

export const path = defineQuery<PathParams, PathRow>({
  name: "path",
  description: "Shortest call path between two symbols, as an ordered list of nodes, or empty if none exists.",
  params: paramsSchema,
  cypher,
  map: (records) =>
    records.map((rec) => ({
      id: rec.get("id") as string,
      name: rec.get("name") as string,
      path: rec.get("path") as string,
    })),
});
