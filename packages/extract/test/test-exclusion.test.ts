import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { walkRepo } from "../src/walk.js";
import { addSourceFiles, createProject } from "../src/project.js";
import { extractCode } from "../src/code.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "fixtures", "with-tests");

describe("test files are excluded from the call graph and metric", () => {
  const files = walkRepo(REPO);
  const project = createProject(REPO);
  addSourceFiles(project, files.map((f) => f.absPath));
  const out = extractCode(project, files, "repo");

  it("classifies the .test.ts file as a test", () => {
    const test = files.find((f) => f.relPath.endsWith("app.test.ts"));
    expect(test?.isTest).toBe(true);
  });

  it("keeps the in-app call but drops the test's call to the same symbol", () => {
    // welcome() -> greet() is application structure and must be present.
    expect(out.calls).toContainEqual({
      repoId: "repo",
      fromSymbolId: "src/app.ts#welcome",
      toSymbolId: "src/app.ts#greet",
    });
    // The test file also calls greet(), but no edge may originate there.
    expect(out.calls.every((e) => !e.fromSymbolId.includes(".test.ts"))).toBe(true);
    expect(out.calls).toHaveLength(1);
  });

  it("counts only the non-test call site in the metric", () => {
    // app.ts observes exactly one call (greet in welcome); the test file's
    // call site is not counted at all.
    expect(out.callsObserved).toBe(1);
    expect(out.callsInScope).toBe(1);
    expect(out.callsResolved).toBe(1);
  });

  it("still records the test file's import (tests remain visible as files)", () => {
    expect(out.imports).toContainEqual({
      repoId: "repo",
      fromPath: "src/app.test.ts",
      toPath: "src/app.ts",
    });
  });
});
