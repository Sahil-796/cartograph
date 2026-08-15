import { z } from "zod";
import { defineQuery } from "./types.js";

/**
 * The whole-repo file-level structure the map renders: every File node
 * plus the aggregated File->File import edges between them.
 *
 * One query, one result set, discriminated by `kind`:
 *   - `kind: "node"` rows carry the file's display attributes
 *     (`path, ext, loc, isTest, isGenerated`) and null edge fields.
 *   - `kind: "edge"` rows carry `fromPath, toPath, weight` and null node
 *     fields.
 * The two branches are UNIONed, so a single call returns everything the
 * client needs to lay out the graph; the client separates the two by
 * `kind`.
 *
 * Granularity is FILE-level only — symbol-level (CALLS) edges never
 * appear here. Import edges are the loader's `(:File)-[:IMPORTS]->(:File)`
 * relationships. The loader MERGEs those, so there is at most one IMPORTS
 * relationship per ordered (fromPath, toPath) pair; `weight = count(r)` is
 * therefore effectively 1 today, but the aggregation is written defensively
 * so it stays correct if the loader ever stores duplicate specifier edges.
 * The client caps to top-N by weight.
 *
 * Generated files ARE included (flagged via `isGenerated`) rather than
 * dropped here — the client decides whether to hide them, which keeps this
 * query lossless.
 */

const paramsSchema = z.object({
  repoId: z.string(),
});

export type FileGraphParams = z.infer<typeof paramsSchema>;

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

const cypher = `
MATCH (f:File {repoId: $repoId})
RETURN "node" AS kind,
  f.path AS path, f.ext AS ext, f.loc AS loc, f.isTest AS isTest, f.isGenerated AS isGenerated,
  null AS fromPath, null AS toPath, null AS weight
UNION
MATCH (a:File {repoId: $repoId})-[r:IMPORTS]->(b:File {repoId: $repoId})
WITH a.path AS fromPath, b.path AS toPath, count(r) AS weight
RETURN "edge" AS kind,
  null AS path, null AS ext, null AS loc, null AS isTest, null AS isGenerated,
  fromPath, toPath, weight
`;

export const fileGraph = defineQuery<FileGraphParams, FileGraphRow>({
  name: "file_graph",
  description:
    "The whole-repo file-level structure the map renders: every file node and the aggregated file-to-file import edges (weighted), in one call.",
  params: paramsSchema,
  cypher,
  map: (records): FileGraphRow[] =>
    records.map((rec) => {
      const kind = rec.get("kind") as "node" | "edge";
      if (kind === "node") {
        return {
          kind: "node",
          path: rec.get("path") as string,
          ext: rec.get("ext") as string,
          loc: toNumber(rec.get("loc")),
          isTest: Boolean(rec.get("isTest")),
          isGenerated: Boolean(rec.get("isGenerated")),
        };
      }
      return {
        kind: "edge",
        fromPath: rec.get("fromPath") as string,
        toPath: rec.get("toPath") as string,
        weight: toNumber(rec.get("weight")),
      };
    }),
});

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof (v as { toNumber?: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}
