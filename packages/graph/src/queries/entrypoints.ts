import { z } from "zod";
import { defineQuery } from "./types.js";

/**
 * The app's public surface: every Entrypoint with its handler symbol.
 */

const paramsSchema = z.object({
  repoId: z.string(),
});

export type EntrypointsParams = z.infer<typeof paramsSchema>;

export interface EntrypointsRow {
  method: string | null;
  path: string;
  handler: string | null;
}

const cypher = `
MATCH (e:Entrypoint {repoId: $repoId})
OPTIONAL MATCH (e)-[:HANDLED_BY]->(s:Symbol {repoId: $repoId})
RETURN e.method AS method, e.path AS path, s.name AS handler
ORDER BY e.path ASC
`;

export const entrypoints = defineQuery<EntrypointsParams, EntrypointsRow>({
  name: "entrypoints",
  description: "All entrypoints (routes/handlers) with their handler symbol name.",
  params: paramsSchema,
  cypher,
  map: (records) =>
    records.map((rec) => ({
      method: (rec.get("method") as string | null) ?? null,
      path: rec.get("path") as string,
      handler: (rec.get("handler") as string | null) ?? null,
    })),
});
