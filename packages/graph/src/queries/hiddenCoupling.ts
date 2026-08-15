import { z } from "zod";
import { defineQuery } from "./types.js";

/**
 * THE headline query: co-change pairs with no import path within 4 hops.
 * Files that move together in commits but have no visible structural
 * link — the coupling SQL can't see and imports don't explain.
 */

const paramsSchema = z.object({
  repoId: z.string(),
  minCount: z.number().int().positive().default(3),
  limit: z.number().int().positive().default(50),
});

export type HiddenCouplingParams = z.infer<typeof paramsSchema>;

export interface HiddenCouplingRow {
  a: string;
  b: string;
  count: number;
  strength: number;
}

const cypher = `
MATCH (a:File {repoId: $repoId})-[cc:CO_CHANGES]->(b:File {repoId: $repoId})
WHERE cc.count >= $minCount AND NOT (a)-[:IMPORTS*1..4]-(b)
RETURN a.path AS a, b.path AS b, cc.count AS count, cc.strength AS strength
ORDER BY cc.strength DESC
LIMIT $limit
`;

export const hiddenCoupling = defineQuery<HiddenCouplingParams, HiddenCouplingRow>({
  name: "hidden_coupling",
  description:
    "Co-change pairs with no import path within 4 hops — files that move together in history but have no visible structural link.",
  // Cast: zod's Input type for a schema with `.default()` fields
  // (optional on input, required on output) doesn't unify with
  // `ZodType<Params>`'s Input===Output===Params constraint. The runtime
  // contract still holds — `HiddenCouplingParams` (the full, defaulted shape) is
  // always accepted by `paramsSchema.parse(...)`.
  params: paramsSchema as unknown as import("zod").ZodType<HiddenCouplingParams>,
  cypher,
  map: (records) =>
    records.map((rec) => ({
      a: rec.get("a") as string,
      b: rec.get("b") as string,
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
