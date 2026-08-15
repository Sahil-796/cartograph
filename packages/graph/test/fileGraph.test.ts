import "../src/scripts/load-env.js";
import type { Record as Neo4jRecord } from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { getQuery } from "../src/queries/index.js";
import { fileGraph, type FileGraphRow } from "../src/queries/index.js";

function fakeRecord(obj: Record<string, unknown>): Neo4jRecord {
  return { get: (key: string) => obj[key] } as unknown as Neo4jRecord;
}

describe("file_graph", () => {
  it("is registered and resolvable by name", () => {
    expect(getQuery("file_graph")).toBe(fileGraph);
  });

  it("rejects missing repoId", () => {
    expect(() => fileGraph.params.parse({} as never)).toThrow();
  });

  it("maps node and edge rows into a discriminated union", () => {
    const rows = fileGraph.map([
      fakeRecord({
        kind: "node",
        path: "src/a.ts",
        ext: ".ts",
        loc: 42,
        isTest: false,
        isGenerated: false,
        fromPath: null,
        toPath: null,
        weight: null,
      }),
      fakeRecord({
        kind: "edge",
        path: null,
        ext: null,
        loc: null,
        isTest: null,
        isGenerated: null,
        fromPath: "src/a.ts",
        toPath: "src/b.ts",
        weight: 3,
      }),
    ]);

    const node = rows.find((r) => r.kind === "node") as Extract<FileGraphRow, { kind: "node" }>;
    const edge = rows.find((r) => r.kind === "edge") as Extract<FileGraphRow, { kind: "edge" }>;
    expect(node).toMatchObject({ path: "src/a.ts", ext: ".ts", loc: 42, isTest: false, isGenerated: false });
    expect(edge).toMatchObject({ fromPath: "src/a.ts", toPath: "src/b.ts", weight: 3 });
  });
});
