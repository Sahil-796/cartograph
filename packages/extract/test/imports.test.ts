import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createProject, addSourceFiles } from "../src/project.js";
import { walkRepo } from "../src/walk.js";
import { createResolver, extractImports } from "../src/imports.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CODE_REPO = join(__dirname, "fixtures", "code-repo");

describe("createResolver", () => {
  const repoFiles = new Set(["src/math.ts", "src/main.ts", "src/pkg/index.tsx"]);
  const resolve = createResolver(repoFiles);

  it("resolves a relative specifier with implicit extension", () => {
    expect(resolve("src/main.ts", "./math")).toBe("src/math.ts");
  });

  it("remaps NodeNext .js specifiers to .ts source", () => {
    expect(resolve("src/main.ts", "./math.js")).toBe("src/math.ts");
  });

  it("resolves a directory import to index.*", () => {
    expect(resolve("src/main.ts", "./pkg")).toBe("src/pkg/index.tsx");
  });

  it("drops bare package specifiers", () => {
    expect(resolve("src/main.ts", "react")).toBeUndefined();
    expect(resolve("src/main.ts", "node:fs")).toBeUndefined();
  });

  it("returns undefined for a relative path that does not exist", () => {
    expect(resolve("src/main.ts", "./missing")).toBeUndefined();
  });

  it("resolves tsconfig path aliases when provided", () => {
    const aliased = createResolver(repoFiles, new Map([["@app/*", ["src"]]]));
    expect(aliased("src/main.ts", "@app/math")).toBe("src/math.ts");
  });
});

describe("extractImports", () => {
  const files = walkRepo(CODE_REPO);
  const project = createProject(CODE_REPO);
  addSourceFiles(project, files.map((f) => f.absPath));
  const resolve = createResolver(new Set(files.map((f) => f.relPath)));

  const mainFile = files.find((f) => f.relPath === "src/main.ts")!;
  const sf = project.getSourceFile(mainFile.absPath)!;
  const edges = extractImports(sf, "repo", "src/main.ts", resolve);

  it("emits an edge for a resolvable relative import", () => {
    expect(edges).toContainEqual({ repoId: "repo", fromPath: "src/main.ts", toPath: "src/math.ts" });
  });

  it("drops the external (node:fs) import entirely", () => {
    expect(edges.some((e) => e.toPath.includes("fs"))).toBe(false);
    expect(edges).toHaveLength(1);
  });
});
