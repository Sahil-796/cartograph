import { z } from "zod";
import { defineQuery } from "./types.js";

/**
 * Test files that (directly) exercise a given file, for the side-panel
 * tests row: every `File {isTest: true}` that has an IMPORTS edge pointing
 * at `path`. Direct imports only — no transitive walk. Empty array when
 * nothing imports it.
 */

const paramsSchema = z.object({
  repoId: z.string(),
  path: z.string(),
});

export type TestsForFileParams = z.infer<typeof paramsSchema>;

export interface TestsForFileRow {
  path: string;
  ext: string;
}

const cypher = `
MATCH (t:File {repoId: $repoId})-[:IMPORTS]->(f:File {repoId: $repoId, path: $path})
WHERE t.isTest = true
RETURN t.path AS path, t.ext AS ext
ORDER BY t.path ASC
`;

export const testsForFile = defineQuery<TestsForFileParams, TestsForFileRow>({
  name: "tests_for_file",
  description:
    "Test files that directly import (exercise) a given file — the side-panel tests row for a single file.",
  params: paramsSchema,
  cypher,
  map: (records) =>
    records.map((rec) => ({
      path: rec.get("path") as string,
      ext: rec.get("ext") as string,
    })),
});
