import { describe, expect, it } from "vitest";
import { computeCoChange } from "../src/cochange.js";
import type { CommitNode, TouchedEdge } from "../src/payload.js";

const REPO_ID = "repo-1";

/** Builds a minimal CommitNode; only `sha` matters to computeCoChange. */
function commit(sha: string): CommitNode {
  return { repoId: REPO_ID, sha, authorEmail: "a@example.com", timestamp: "2024-01-01T00:00:00Z", message: "msg" };
}

/** Builds a TouchedEdge for `sha` touching each of `paths`. */
function touches(sha: string, paths: string[]): TouchedEdge[] {
  return paths.map((path) => ({ repoId: REPO_ID, sha, path, additions: 1, deletions: 0 }));
}

describe("computeCoChange", () => {
  it("counts a pair touched together across multiple commits", () => {
    const commits = [commit("c1"), commit("c2"), commit("c3")];
    const touched = [
      ...touches("c1", ["a.ts", "b.ts"]),
      ...touches("c2", ["a.ts", "b.ts"]),
      ...touches("c3", ["a.ts", "b.ts"]),
    ];

    const edges = computeCoChange(commits, touched, REPO_ID);

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ repoId: REPO_ID, pathA: "a.ts", pathB: "b.ts", count: 3 });
  });

  it("drops pairs below the count>=3 threshold", () => {
    const commits = [commit("c1"), commit("c2")];
    const touched = [...touches("c1", ["a.ts", "b.ts"]), ...touches("c2", ["a.ts", "b.ts"])];

    const edges = computeCoChange(commits, touched, REPO_ID);

    expect(edges).toHaveLength(0);
  });

  it("skips commits touching more than 30 files", () => {
    const bigCommitFiles = Array.from({ length: 31 }, (_, i) => `file${i}.ts`);
    const commits = [commit("big"), commit("c1"), commit("c2"), commit("c3")];
    const touched = [
      ...touches("big", bigCommitFiles),
      ...touches("c1", ["a.ts", "b.ts"]),
      ...touches("c2", ["a.ts", "b.ts"]),
      ...touches("c3", ["a.ts", "b.ts"]),
    ];

    const edges = computeCoChange(commits, touched, REPO_ID);

    // Only a.ts/b.ts should appear; nothing from the 31-file commit.
    expect(edges).toHaveLength(1);
    expect(edges[0]?.pathA).toBe("a.ts");
    expect(edges[0]?.pathB).toBe("b.ts");
  });

  it("does not count a 30-file commit as skipped (boundary is > 30, not >= 30)", () => {
    const files = Array.from({ length: 30 }, (_, i) => `file${i}.ts`);
    const commits = [commit("c1"), commit("c2"), commit("c3")];
    const touched = [
      ...touches("c1", [files[0]!, files[1]!]),
      ...touches("c2", [files[0]!, files[1]!]),
      ...touches("c3", files),
    ];

    const edges = computeCoChange(commits, touched, REPO_ID);
    const pair = edges.find((e) => e.pathA === files[0] && e.pathB === files[1]);
    expect(pair).toBeDefined();
    expect(pair?.count).toBe(3);
  });

  it("computes strength as count / sqrt(freqA * freqB)", () => {
    // a.ts touched in c1,c2,c3,c4 (freq 4); b.ts touched in c1,c2,c3 (freq 3);
    // pair count = 3 (c1,c2,c3).
    const commits = [commit("c1"), commit("c2"), commit("c3"), commit("c4")];
    const touched = [
      ...touches("c1", ["a.ts", "b.ts"]),
      ...touches("c2", ["a.ts", "b.ts"]),
      ...touches("c3", ["a.ts", "b.ts"]),
      ...touches("c4", ["a.ts"]),
    ];

    const edges = computeCoChange(commits, touched, REPO_ID);

    expect(edges).toHaveLength(1);
    const expected = 3 / Math.sqrt(4 * 3);
    expect(edges[0]?.strength).toBeCloseTo(expected, 10);
    expect(edges[0]?.strength).toBeGreaterThan(0);
    expect(edges[0]?.strength).toBeLessThanOrEqual(1);
  });

  it("canonicalises pair order so pathA < pathB regardless of touch order", () => {
    const commits = [commit("c1"), commit("c2"), commit("c3")];
    const touched = [
      ...touches("c1", ["z.ts", "a.ts"]),
      ...touches("c2", ["a.ts", "z.ts"]),
      ...touches("c3", ["z.ts", "a.ts"]),
    ];

    const edges = computeCoChange(commits, touched, REPO_ID);

    expect(edges).toHaveLength(1);
    expect(edges[0]?.pathA).toBe("a.ts");
    expect(edges[0]?.pathB).toBe("z.ts");
  });

  it("de-duplicates a pair into a single edge even with many shared commits", () => {
    const commits = Array.from({ length: 5 }, (_, i) => commit(`c${i}`));
    const touched = commits.flatMap((c) => touches(c.sha, ["a.ts", "b.ts", "c.ts"]));

    const edges = computeCoChange(commits, touched, REPO_ID);

    // 3 files -> 3 unique pairs, each appearing exactly once.
    expect(edges).toHaveLength(3);
    const keys = edges.map((e) => `${e.pathA}|${e.pathB}`);
    expect(new Set(keys).size).toBe(3);
  });

  it("returns an empty array for no commits", () => {
    expect(computeCoChange([], [], REPO_ID)).toEqual([]);
  });
});
