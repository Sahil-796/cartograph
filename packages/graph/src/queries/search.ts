import { z } from "zod";
import { defineQuery } from "./types.js";

/**
 * Free-text search across Files, Symbols and Entrypoints by name/path.
 * Case-insensitive `CONTAINS` on lowercased strings. Returns a unified
 * list discriminated by `type`, so callers don't need three separate
 * calls to find "where is X".
 */

const paramsSchema = z.object({
  repoId: z.string(),
  term: z.string().min(1),
  // Normalised to `null` (never `undefined`) because the neo4j driver
  // rejects `undefined` values inside a parameters object.
  kinds: z
    .array(z.enum(["file", "symbol", "entrypoint"]))
    .optional()
    .transform((v) => v ?? null),
});

export type SearchParams = z.infer<typeof paramsSchema>;

export interface SearchRow {
  type: "file" | "symbol" | "entrypoint";
  id: string;
  name: string;
  path: string;
}

const cypher = `
CALL {
  WITH $repoId AS repoId, toLower($term) AS term
  MATCH (f:File {repoId: repoId})
  WHERE toLower(f.path) CONTAINS term
  RETURN "file" AS type, f.path AS id, f.path AS name, f.path AS path
  UNION ALL
  WITH $repoId AS repoId, toLower($term) AS term
  MATCH (s:Symbol {repoId: repoId})
  WHERE toLower(s.name) CONTAINS term OR toLower(s.path) CONTAINS term
  RETURN "symbol" AS type, s.id AS id, s.name AS name, s.path AS path
  UNION ALL
  WITH $repoId AS repoId, toLower($term) AS term
  MATCH (e:Entrypoint {repoId: repoId})
  WHERE toLower(e.path) CONTAINS term OR toLower(e.raw) CONTAINS term
  RETURN "entrypoint" AS type, e.id AS id, e.path AS name, e.path AS path
}
WITH type, id, name, path
WHERE $kinds IS NULL OR type IN $kinds
RETURN type, id, name, path
LIMIT 50
`;

export const search = defineQuery<SearchParams, SearchRow>({
  name: "search",
  description:
    "Search files, symbols, and entrypoints by name or path (case-insensitive substring match), optionally restricted to specific node kinds.",
  // Cast: zod's Input type for a schema with `.default()` fields
  // (optional on input, required on output) doesn't unify with
  // `ZodType<Params>`'s Input===Output===Params constraint. The runtime
  // contract still holds — `SearchParams` (the full, defaulted shape) is
  // always accepted by `paramsSchema.parse(...)`.
  params: paramsSchema as unknown as import("zod").ZodType<SearchParams>,
  cypher,
  map: (records) =>
    records.map((rec) => ({
      type: rec.get("type") as SearchRow["type"],
      id: rec.get("id") as string,
      name: rec.get("name") as string,
      path: rec.get("path") as string,
    })),
});
