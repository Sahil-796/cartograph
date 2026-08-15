import { z } from "zod";
import { defineQuery } from "./types.js";

/**
 * Recent commits that touched a single file, for the side-panel history
 * row. Ordered newest first, limited (default 20).
 *
 * Matches the existing ownership queries' convention of excluding giant
 * commits via `c.fileCount <= 30` (see `who_touched.ts`/`bus_factor.ts`),
 * so the history a user sees lines up with the commits that drive
 * ownership/bus-factor. `committedAt` is epoch SECONDS.
 */

const paramsSchema = z.object({
  repoId: z.string(),
  path: z.string(),
  limit: z.number().int().positive().default(20),
});

export type FileCommitsParams = z.infer<typeof paramsSchema>;

export interface FileCommitsRow {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  committedAt: number;
}

const cypher = `
MATCH (a:Author {repoId: $repoId})-[:AUTHORED]->(c:Commit {repoId: $repoId})-[:CHANGED]->(f:File {repoId: $repoId, path: $path})
WHERE c.fileCount <= 30
RETURN c.sha AS sha, c.message AS message, a.name AS authorName, a.email AS authorEmail, c.committedAt AS committedAt
ORDER BY c.committedAt DESC
LIMIT $limit
`;

export const fileCommits = defineQuery<FileCommitsParams, FileCommitsRow>({
  name: "file_commits",
  description:
    "Recent commits that touched a file, newest first (limited) — the side-panel history for a single file.",
  // Cast: zod's Input type for a schema with `.default()` fields
  // (optional on input, required on output) doesn't unify with
  // `ZodType<Params>`'s Input===Output===Params constraint. The runtime
  // contract still holds — `FileCommitsParams` (the full, defaulted shape)
  // is always accepted by `paramsSchema.parse(...)`.
  params: paramsSchema as unknown as import("zod").ZodType<FileCommitsParams>,
  cypher,
  map: (records) =>
    records.map((rec) => ({
      sha: rec.get("sha") as string,
      message: rec.get("message") as string,
      authorName: rec.get("authorName") as string,
      authorEmail: rec.get("authorEmail") as string,
      committedAt: toNumber(rec.get("committedAt")),
    })),
});

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof (v as { toNumber?: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}
