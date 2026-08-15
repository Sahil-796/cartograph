import { z } from "zod";
import { defineQuery } from "./types.js";

/**
 * Truck factor for a path scope: the smallest number of authors whose
 * combined time-decayed contribution weight crosses 50% of the total.
 * Reuses the same weighting as `who_touched`; the ranked weights are
 * computed in Cypher, and the cumulative-50% cutoff is computed in
 * `map()` since it's a running-total over an already-ordered list.
 */

const paramsSchema = z.object({
  repoId: z.string(),
  scope: z.string(),
  halfLifeDays: z.number().positive().default(180),
  now: z
    .number()
    .int()
    .default(() => Math.floor(Date.now() / 1000)),
});

export type BusFactorParams = z.infer<typeof paramsSchema>;

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

const cypher = `
MATCH (a:Author {repoId: $repoId})-[:AUTHORED]->(c:Commit {repoId: $repoId})-[ch:CHANGED]->(f:File {repoId: $repoId})
WHERE f.path STARTS WITH $scope AND c.fileCount <= 30
WITH a, f, c, ch,
  (CASE WHEN ch.added + ch.deleted > 500 THEN 500 ELSE ch.added + ch.deleted END)
    * 0.5 ^ ((($now - c.committedAt) / 86400.0) / $halfLifeDays) AS w
WITH a, sum(w) AS weight
RETURN a.name AS name, a.email AS email, weight
ORDER BY weight DESC
`;

export const busFactor = defineQuery<BusFactorParams, BusFactorRow>({
  name: "bus_factor",
  description:
    "Truck factor for a path scope: the fewest authors whose combined weighted contribution covers half the work — a single-point-of-failure signal.",
  // Cast: zod's Input type for a schema with `.default()` fields
  // (optional on input, required on output) doesn't unify with
  // `ZodType<Params>`'s Input===Output===Params constraint. The runtime
  // contract still holds — `BusFactorParams` (the full, defaulted shape) is
  // always accepted by `paramsSchema.parse(...)`.
  params: paramsSchema as unknown as import("zod").ZodType<BusFactorParams>,
  cypher,
  // A single logical row (`busFactor` + ranked contributors), computed by
  // reducing the per-author weight rows returned by Cypher.
  map: (records): BusFactorRow[] => {
    const authors = records.map((rec) => ({
      name: rec.get("name") as string,
      email: rec.get("email") as string,
      weight: toNumber(rec.get("weight")),
    }));
    const total = authors.reduce((sum, a) => sum + a.weight, 0);
    const withShare: BusFactorAuthor[] = authors.map((a) => ({
      ...a,
      share: total > 0 ? a.weight / total : 0,
    }));

    let cumulative = 0;
    let busFactorCount = 0;
    for (const a of withShare) {
      cumulative += a.share;
      busFactorCount += 1;
      if (cumulative >= 0.5) break;
    }

    return [{ busFactor: busFactorCount, contributors: withShare }];
  },
});

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof (v as { toNumber?: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}
