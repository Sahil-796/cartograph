// `../src/queries/index.js` transitively imports `../src/driver.js`,
// which imports `@cartograph/config` — a singleton that validates
// `process.env` at import time and `process.exit(1)`s if required vars
// are missing. Static imports run in first-encountered order, so this
// (dependency-free) import of the repo-root `.env` loader must be listed
// first, ahead of the queries import, to populate `process.env` before
// `@cartograph/config` evaluates. Same helper the CLI scripts use; if
// there's no `.env` in this environment, it silently no-ops and the
// live-DB describe block below skips itself.
import "../src/scripts/load-env.js";
import { describe, expect, it } from "vitest";
import { getDriver } from "../src/driver.js";
import { getQuery, queries } from "../src/queries/index.js";

describe("query registry — structural", () => {
  it("has exactly 9 queries", () => {
    expect(queries).toHaveLength(9);
  });

  it("every name is unique and snake_case", () => {
    const names = queries.map((q) => q.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it("expects the exact query set from the plan", () => {
    const names = queries.map((q) => q.name).sort();
    expect(names).toEqual(
      [
        "bus_factor",
        "co_changed",
        "cycles",
        "entrypoints",
        "hidden_coupling",
        "neighbors",
        "path",
        "search",
        "who_touched",
      ].sort(),
    );
  });

  it("each query has a non-empty description, a zod params schema, non-empty cypher, and a map function", () => {
    for (const q of queries) {
      expect(q.description.length).toBeGreaterThan(0);
      expect(typeof q.params.parse).toBe("function");
      expect(q.cypher.trim().length).toBeGreaterThan(0);
      expect(typeof q.map).toBe("function");
    }
  });

  it("getQuery resolves each registered name and returns undefined for unknown names", () => {
    for (const q of queries) {
      expect(getQuery(q.name)).toBe(q);
    }
    expect(getQuery("does_not_exist")).toBeUndefined();
  });

  it("no cypher string contains template interpolation or obvious string concatenation of params", () => {
    for (const q of queries) {
      expect(q.cypher).not.toContain("${");
      // Guard against building the query by concatenating a JS param
      // value into the string (e.g. `"... " + repoId + " ..."`), as
      // opposed to a `$repoId` Cypher parameter reference.
      expect(q.cypher).not.toMatch(/["'`]\s*\+\s*\w/);
      expect(q.cypher).not.toMatch(/\w\s*\+\s*["'`]/);
    }
  });

  it("neighbors and who_touched cypher never bind a variable-length range to a parameter (the *1..$ gotcha)", () => {
    const neighbors = getQuery("neighbors")!;
    const whoTouched = getQuery("who_touched")!;
    for (const q of [neighbors, whoTouched]) {
      expect(q.cypher).not.toMatch(/\*\d*\.\.\$/);
    }
  });

  it("no query's cypher contains a write clause — every query is read-only", () => {
    for (const q of queries) {
      expect(q.cypher).not.toMatch(/\bMERGE\b|\bCREATE\b|\bSET\b|\bDELETE\b|\bDROP\b/i);
    }
  });

  it("every query filters on repoId", () => {
    for (const q of queries) {
      expect(q.cypher).toContain("$repoId");
    }
  });
});

describe("query registry — live DB syntax check", () => {
  const BENIGN = {
    repoId: "__nonexistent_repo__",
    term: "nope",
    nodeId: "nope#nope",
    fromId: "nope#a",
    toId: "nope#b",
    scope: "src/",
    fileId: "does/not/exist.ts",
  };

  it("every query's cypher parses and runs against the live DB with benign params", async () => {
    try {
      await getDriver().verifyConnectivity();
    } catch {
      console.warn("Skipping live DB syntax check — CognoDB unreachable in this environment.");
      return;
    }

    for (const q of queries) {
      const params = { ...BENIGN, ...q.params.parse(BENIGN as never) };
      const session = getDriver().session();
      try {
        // We only care that the cypher PARSES and EXECUTES (read-only,
        // benign repoId => empty result set) — not the row shape.
        await session.run(q.cypher, params as Record<string, unknown>);
      } finally {
        await session.close();
      }
    }
  }, 30_000);
});

