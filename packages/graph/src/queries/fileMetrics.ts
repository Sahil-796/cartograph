import { z } from "zod";
import { defineQuery } from "./types.js";

/**
 * Per-file colour attributes for the WHOLE repo in one shot, so the map
 * can recolour every node for each colour mode without a call per file.
 *
 * Per file `path`, returns:
 *   - `ownerName`   — top author by the SAME time-decayed weighting
 *     `who_touched`/`bus_factor` use (changed-lines capped at 500, decayed
 *     by `halfLifeDays`, giant commits `fileCount > 30` excluded), or null
 *     if no attributable commit touched the file.
 *   - `lastCommitAt` — max `committedAt` (epoch seconds) of ALL commits
 *     that CHANGED the file (NOT restricted by `fileCount`, since this is a
 *     history fact, not a weighting), or null if untouched.
 *   - `busFactor`   — per-file truck factor: the fewest authors whose
 *     combined weighted contribution covers half the file's work, computed
 *     exactly like `bus_factor.ts` (cumulative-50% over the ranked weights).
 *     0 when the file has no weighted contribution.
 *   - `coveredByTest` — true iff some `File {isTest: true}` directly imports
 *     this file.
 *
 * Cypher returns rows at (file, author) granularity — one row per author
 * who has weighted contribution to a file, plus a single null-author row
 * for files with none. `map()` groups by path and does the owner-pick and
 * the cumulative-50% bus-factor reduction (a running total over an ordered
 * list, exactly as `bus_factor.ts` does it). `now`/`halfLifeDays` are
 * computed here, not in Cypher, so the decay math is deterministic — same
 * idiom as `who_touched`; `committedAt` is epoch SECONDS.
 */

const paramsSchema = z.object({
  repoId: z.string(),
  halfLifeDays: z.number().positive().default(180),
  now: z
    .number()
    .int()
    .default(() => Math.floor(Date.now() / 1000)),
});

export type FileMetricsParams = z.infer<typeof paramsSchema>;

export interface FileMetricsRow {
  path: string;
  ownerName: string | null;
  lastCommitAt: number | null;
  busFactor: number;
  coveredByTest: boolean;
}

const cypher = `
MATCH (f:File {repoId: $repoId})
OPTIONAL MATCH (t:File {repoId: $repoId})-[:IMPORTS]->(f)
  WHERE t.isTest = true
WITH f, count(t) > 0 AS coveredByTest
OPTIONAL MATCH (lc:Commit {repoId: $repoId})-[:CHANGED]->(f)
WITH f, coveredByTest, max(lc.committedAt) AS lastCommitAt
OPTIONAL MATCH (a:Author {repoId: $repoId})-[:AUTHORED]->(c:Commit {repoId: $repoId})-[ch:CHANGED]->(f)
  WHERE c.fileCount <= 30
WITH f, coveredByTest, lastCommitAt, a,
  sum(
    (CASE WHEN ch.added + ch.deleted > 500 THEN 500 ELSE ch.added + ch.deleted END)
      * 0.5 ^ ((($now - c.committedAt) / 86400.0) / $halfLifeDays)
  ) AS weight
RETURN f.path AS path, coveredByTest, lastCommitAt, a.name AS authorName, weight
ORDER BY path ASC, weight DESC
`;

export const fileMetrics = defineQuery<FileMetricsParams, FileMetricsRow>({
  name: "file_metrics",
  description:
    "Per-file colour attributes for the whole repo in one call: owner (time-decayed), last commit time, per-file bus factor, and test coverage.",
  // Cast: zod's Input type for a schema with `.default()` fields
  // (optional on input, required on output) doesn't unify with
  // `ZodType<Params>`'s Input===Output===Params constraint. The runtime
  // contract still holds — `FileMetricsParams` (the full, defaulted shape)
  // is always accepted by `paramsSchema.parse(...)`.
  params: paramsSchema as unknown as import("zod").ZodType<FileMetricsParams>,
  cypher,
  map: (records): FileMetricsRow[] => {
    // Group the (file, author) rows by path.
    interface Acc {
      coveredByTest: boolean;
      lastCommitAt: number | null;
      authors: { name: string; weight: number }[];
    }
    const byPath = new Map<string, Acc>();
    for (const rec of records) {
      const path = rec.get("path") as string;
      let acc = byPath.get(path);
      if (!acc) {
        acc = {
          coveredByTest: Boolean(rec.get("coveredByTest")),
          lastCommitAt: toNumberOrNull(rec.get("lastCommitAt")),
          authors: [],
        };
        byPath.set(path, acc);
      }
      const name = rec.get("authorName") as string | null;
      const weight = toNumber(rec.get("weight"));
      // Files with no attributable commit produce a single null-author,
      // zero-weight row — skip it so `authors` stays empty.
      if (name !== null && name !== undefined && weight > 0) {
        acc.authors.push({ name, weight });
      }
    }

    const rows: FileMetricsRow[] = [];
    for (const [path, acc] of byPath) {
      // Authors already arrive ordered by weight DESC per path.
      const total = acc.authors.reduce((sum, a) => sum + a.weight, 0);
      let cumulative = 0;
      let busFactor = 0;
      for (const a of acc.authors) {
        cumulative += total > 0 ? a.weight / total : 0;
        busFactor += 1;
        if (cumulative >= 0.5) break;
      }
      rows.push({
        path,
        ownerName: acc.authors.length > 0 ? acc.authors[0].name : null,
        lastCommitAt: acc.lastCommitAt,
        busFactor,
        coveredByTest: acc.coveredByTest,
      });
    }
    return rows;
  },
});

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof (v as { toNumber?: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return toNumber(v);
}
