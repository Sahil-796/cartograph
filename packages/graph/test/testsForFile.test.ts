import "../src/scripts/load-env.js";
import type { Record as Neo4jRecord } from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { getQuery } from "../src/queries/index.js";
import { testsForFile } from "../src/queries/index.js";

function fakeRecord(obj: Record<string, unknown>): Neo4jRecord {
  return { get: (key: string) => obj[key] } as unknown as Neo4jRecord;
}

describe("tests_for_file", () => {
  it("is registered and resolvable by name", () => {
    expect(getQuery("tests_for_file")).toBe(testsForFile);
  });

  it("rejects missing path", () => {
    expect(() => testsForFile.params.parse({ repoId: "r" } as never)).toThrow();
  });

  it("maps test-file rows and yields an empty array for no records", () => {
    expect(testsForFile.map([])).toEqual([]);
    const rows = testsForFile.map([fakeRecord({ path: "src/a.test.ts", ext: ".ts" })]);
    expect(rows).toEqual([{ path: "src/a.test.ts", ext: ".ts" }]);
  });
});
