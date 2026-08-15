/**
 * Local typed wrappers for the queries this feature drives that are NOT in
 * `lib/queries.ts` (the four Unit-E additions). Declared here per the unit
 * contract — `lib/queries.ts` is not ours to edit. Existing queries
 * (`who_touched`, `co_changed`, `bus_factor`) are imported from `lib/queries`.
 */

import { runQuery } from "../../lib/api";

/** A commit that touched a single file. `committedAt` is epoch SECONDS. */
export interface FileCommitsRow {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  committedAt: number;
}

/** A test file that directly imports the selected file. */
export interface TestsForFileRow {
  path: string;
  ext: string;
}

/** Recent commits that touched `path`, newest first. */
export function fileCommits(
  repoId: string,
  path: string,
  limit?: number,
  signal?: AbortSignal,
): Promise<FileCommitsRow[]> {
  return runQuery<FileCommitsRow>(
    "file_commits",
    { repoId, path, ...(limit != null ? { limit } : {}) },
    signal,
  );
}

/** Test files that directly import `path` (empty if none). */
export function testsForFile(
  repoId: string,
  path: string,
  signal?: AbortSignal,
): Promise<TestsForFileRow[]> {
  return runQuery<TestsForFileRow>("tests_for_file", { repoId, path }, signal);
}
