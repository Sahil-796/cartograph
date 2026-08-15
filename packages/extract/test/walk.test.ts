import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { countLines, walkRepo } from "../src/walk.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(__dirname, "fixtures", "sample-repo");

describe("walkRepo", () => {
  const files = walkRepo(FIXTURE_ROOT);
  const relPaths = files.map((f) => f.relPath).sort();

  it("finds ts/tsx/js/jsx source files", () => {
    expect(relPaths).toContain("src/foo.ts");
    expect(relPaths).toContain("src/baz.spec.tsx");
  });

  it("excludes node_modules, dist, and other excluded dirs", () => {
    for (const path of relPaths) {
      expect(path).not.toMatch(/(^|\/)node_modules(\/|$)/);
      expect(path).not.toMatch(/(^|\/)dist(\/|$)/);
    }
  });

  it("excludes .d.ts and .min.js files", () => {
    expect(relPaths).not.toContain("src/types.d.ts");
    expect(relPaths).not.toContain("src/lib.min.js");
  });

  it("uses posix-style relative paths", () => {
    for (const path of relPaths) {
      expect(path).not.toContain("\\");
    }
  });

  it("flags __tests__ directory files as tests", () => {
    const file = files.find((f) => f.relPath === "src/__tests__/foo.test.ts");
    expect(file?.isTest).toBe(true);
  });

  it("flags *.test.* and *.spec.* files as tests", () => {
    const file = files.find((f) => f.relPath === "src/baz.spec.tsx");
    expect(file?.isTest).toBe(true);
  });

  it("flags files directly under a top-level test/ dir as tests", () => {
    const file = files.find((f) => f.relPath === "test/qux.ts");
    expect(file?.isTest).toBe(true);
  });

  it("does not flag ordinary source files as tests", () => {
    const file = files.find((f) => f.relPath === "src/foo.ts");
    expect(file?.isTest).toBe(false);
  });

  it("flags *.generated.* files as generated", () => {
    const file = files.find((f) => f.relPath === "src/bar.generated.ts");
    expect(file?.isGenerated).toBe(true);
  });

  it("does not flag ordinary source files as generated", () => {
    const file = files.find((f) => f.relPath === "src/foo.ts");
    expect(file?.isGenerated).toBe(false);
  });

  it("resolves absPath to an existing file with the correct extension", () => {
    const file = files.find((f) => f.relPath === "src/foo.ts");
    expect(file?.ext).toBe(".ts");
    expect(file?.absPath.endsWith("src/foo.ts")).toBe(true);
  });
});

describe("countLines", () => {
  it("counts lines in a file without a trailing-newline off-by-one", () => {
    const file = join(FIXTURE_ROOT, "src", "foo.ts");
    const lines = countLines(file);
    expect(lines).toBe(3);
  });
});
