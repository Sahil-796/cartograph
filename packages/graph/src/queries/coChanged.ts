import { z } from "zod";
import { defineQuery } from "./types.js";

/**
 * Files that historically co-change with a given file, ranked by
 * co-change strength. `CO_CHANGES` is undirected in meaning but stored
 * one direction, so it's matched with an unbound relationship pattern.
 */

const paramsSchema = z.object({
  repoId: z.string(),
  fileId: z.string(),
  minCount: z.number().int().positive().default(3),
});

export type CoChangedParams = z.infer<typeof paramsSchema>;

export interface CoChangedRow {
  path: string;
  count: number;
  strength: number;
}

const cypher = `
MATCH (a:File {repoId: $repoId, path: $fileId})-[cc:CO_CHANGES]-(b:File {repoId: $repoId})
WHERE cc.count >= $minCount
RETURN b.path AS path, cc.count AS count, cc.strength AS strength
ORDER BY cc.strength DESC
`;

export const coChanged = defineQuery<CoChangedParams, CoChangedRow>({
  name: "co_changed",
  description: "Files that historically change together with a given file, ranked by co-change strength.",
  // Cast: zod's Input type for a schema with `.default()` fields
  // (optional on input, required on output) doesn't unify with
  // `ZodType<Params>`'s Input===Output===Params constraint. The runtime
  // contract still holds — `CoChangedParams` (the full, defaulted shape) is
  // always accepted by `paramsSchema.parse(...)`.
  params: paramsSchema as unknown as import("zod").ZodType<CoChangedParams>,
  cypher,
  map: (records) =>
    records.map((rec) => ({
      path: rec.get("path") as string,
      count: toNumber(rec.get("count")),
      strength: toNumber(rec.get("strength")),
    })),
});

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof (v as { toNumber?: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}
