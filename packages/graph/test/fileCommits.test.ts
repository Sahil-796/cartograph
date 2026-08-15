import "../src/scripts/load-env.js";
import type { Record as Neo4jRecord } from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { getQuery } from "../src/queries/index.js";
import { fileCommits } from "../src/queries/index.js";

function fakeRecord(obj: Record<string, unknown>): Neo4jRecord {
  return { get: (key: string) => obj[key] } as unknown as Neo4jRecord;
}

describe("file_commits", () => {
  it("is registered and resolvable by name", () => {
    expect(getQuery("file_commits")).toBe(fileCommits);
  });

  it("rejects missing path", () => {
    expect(() => fileCommits.params.parse({ repoId: "r" } as never)).toThrow();
  });

  it("defaults limit to 20", () => {
    const parsed = fileCommits.params.parse({ repoId: "r", path: "src/a.ts" } as never) as { limit: number };
    expect(parsed.limit).toBe(20);
  });

  it("rejects a non-positive limit", () => {
    expect(() => fileCommits.params.parse({ repoId: "r", path: "src/a.ts", limit: 0 } as never)).toThrow();
  });

  it("maps commit rows", () => {
    const rows = fileCommits.map([
      fakeRecord({
        sha: "abc123",
        message: "fix: thing",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        committedAt: 1700000000,
      }),
    ]);
    expect(rows[0]).toEqual({
      sha: "abc123",
      message: "fix: thing",
      authorName: "Alice",
      authorEmail: "alice@example.com",
      committedAt: 1700000000,
    });
  });
});
