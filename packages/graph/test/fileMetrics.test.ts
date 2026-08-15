import "../src/scripts/load-env.js";
import type { Record as Neo4jRecord } from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { getQuery } from "../src/queries/index.js";
import { fileMetrics, type FileMetricsRow } from "../src/queries/index.js";

function fakeRecord(obj: Record<string, unknown>): Neo4jRecord {
  return { get: (key: string) => obj[key] } as unknown as Neo4jRecord;
}

describe("file_metrics", () => {
  it("is registered and resolvable by name", () => {
    expect(getQuery("file_metrics")).toBe(fileMetrics);
  });

  it("applies defaults for now and halfLifeDays", () => {
    const parsed = fileMetrics.params.parse({ repoId: "r" } as never) as {
      halfLifeDays: number;
      now: number;
    };
    expect(parsed.halfLifeDays).toBe(180);
    expect(typeof parsed.now).toBe("number");
  });

  it("rejects a non-positive halfLifeDays", () => {
    expect(() => fileMetrics.params.parse({ repoId: "r", halfLifeDays: 0 } as never)).toThrow();
  });

  it("picks the top-weight owner and computes per-file bus factor from grouped rows", () => {
    const rows = fileMetrics.map([
      // src/a.ts: two authors, alice dominates (>50%) => busFactor 1.
      fakeRecord({ path: "src/a.ts", coveredByTest: true, lastCommitAt: 1000, authorName: "Alice", weight: 8 }),
      fakeRecord({ path: "src/a.ts", coveredByTest: true, lastCommitAt: 1000, authorName: "Bob", weight: 2 }),
      // src/b.ts: three ~even authors => first is < 50%, need two to cross => busFactor 2.
      fakeRecord({ path: "src/b.ts", coveredByTest: false, lastCommitAt: 900, authorName: "Carol", weight: 4 }),
      fakeRecord({ path: "src/b.ts", coveredByTest: false, lastCommitAt: 900, authorName: "Dave", weight: 3 }),
      fakeRecord({ path: "src/b.ts", coveredByTest: false, lastCommitAt: 900, authorName: "Erin", weight: 3 }),
      // src/c.ts: untouched file, single null-author zero-weight row.
      fakeRecord({ path: "src/c.ts", coveredByTest: false, lastCommitAt: null, authorName: null, weight: 0 }),
    ]) as FileMetricsRow[];

    const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));
    expect(byPath["src/a.ts"]).toMatchObject({ ownerName: "Alice", busFactor: 1, coveredByTest: true, lastCommitAt: 1000 });
    expect(byPath["src/b.ts"]).toMatchObject({ ownerName: "Carol", busFactor: 2, coveredByTest: false });
    expect(byPath["src/c.ts"]).toMatchObject({ ownerName: null, busFactor: 0, lastCommitAt: null, coveredByTest: false });
  });
});
