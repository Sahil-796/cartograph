import { z } from "zod";
import { defineQuery } from "./types.js";

/**
 * Ranked authors by time-decayed weighted contribution to a path scope.
 *
 * Weight per commit: changed-lines (capped at 500) decayed by a half-life
 * in days, so recent, focused commits count more than old, sprawling
 * ones. `now` is computed here (not left to Cypher's `timestamp()`) so
 * the decay math is deterministic and testable from the params object —
 * `executeQuery` passes validated params straight through as Cypher
 * parameters, and `committedAt` on Commit nodes is epoch SECONDS.
 */

const paramsSchema = z.object({
  repoId: z.string(),
  scope: z.string(),
  halfLifeDays: z.number().positive().default(180),
  includeBots: z.boolean().default(false),
  now: z
    .number()
    .int()
    .default(() => Math.floor(Date.now() / 1000)),
});

export type WhoTouchedParams = z.infer<typeof paramsSchema>;

export interface WhoTouchedRow {
  name: string;
  email: string;
  weight: number;
  files: number;
  lastTouch: number;
}

const cypher = `
MATCH (a:Author {repoId: $repoId})-[:AUTHORED]->(c:Commit {repoId: $repoId})-[ch:CHANGED]->(f:File {repoId: $repoId})
WHERE f.path STARTS WITH $scope AND (a.isBot = false OR $includeBots) AND c.fileCount <= 30
WITH a, f, c, ch,
  (CASE WHEN ch.added + ch.deleted > 500 THEN 500 ELSE ch.added + ch.deleted END)
    * 0.5 ^ ((($now - c.committedAt) / 86400.0) / $halfLifeDays) AS w
WITH a, sum(w) AS weight, count(DISTINCT f) AS files, max(c.committedAt) AS lastTouch
RETURN a.name AS name, a.email AS email, weight, files, lastTouch
ORDER BY weight DESC
`;

export const whoTouched = defineQuery<WhoTouchedParams, WhoTouchedRow>({
  name: "who_touched",
  description:
    "Ranked authors by time-decayed weighted contribution to files under a path scope — who actually owns this code.",
  // Cast: zod's Input type for a schema with `.default()` fields
  // (optional on input, required on output) doesn't unify with
  // `ZodType<Params>`'s Input===Output===Params constraint. The runtime
  // contract still holds — `WhoTouchedParams` (the full, defaulted shape) is
  // always accepted by `paramsSchema.parse(...)`.
  params: paramsSchema as unknown as import("zod").ZodType<WhoTouchedParams>,
  cypher,
  map: (records) =>
    records.map((rec) => ({
      name: rec.get("name") as string,
      email: rec.get("email") as string,
      weight: toNumber(rec.get("weight")),
      files: toNumber(rec.get("files")),
      lastTouch: toNumber(rec.get("lastTouch")),
    })),
});

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof (v as { toNumber?: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}
