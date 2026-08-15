import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createProject, addSourceFiles } from "../src/project.js";
import { walkRepo } from "../src/walk.js";
import { extractCode } from "../src/code.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CODE_REPO = join(__dirname, "fixtures", "code-repo");

describe("extractCalls (via extractCode, cross-file resolution)", () => {
  const files = walkRepo(CODE_REPO);
  const project = createProject(CODE_REPO);
  addSourceFiles(project, files.map((f) => f.absPath));
  const out = extractCode(project, files, "repo");

  it("resolves an imported call across files", () => {
    expect(out.calls).toContainEqual({
      repoId: "repo",
      fromSymbolId: "src/main.ts#run",
      toSymbolId: "src/math.ts#add",
    });
  });

  it("resolves a same-file call inside an arrow binding", () => {
    expect(out.calls).toContainEqual({
      repoId: "repo",
      fromSymbolId: "src/math.ts#double",
      toSymbolId: "src/math.ts#add",
    });
  });

  it("skips ambiguous member/unknown calls (no wrong edges)", () => {
    // console.log, readFileSync (external), unknownGlobal must NOT appear.
    for (const edge of out.calls) {
      expect(edge.toSymbolId).toMatch(/^src\/math\.ts#(add)$/);
    }
    expect(out.calls).toHaveLength(2);
  });

  it("counts call sites with the honest in-scope metric", () => {
    // Observed (every CallExpression) = 6:
    //   math.ts: add(n,n), helper()
    //   main.ts: add(), console.log(), readFileSync(), unknownGlobal()
    expect(out.callsObserved).toBe(6);
    // In scope (callee resolves to a known in-repo symbol) = 3:
    //   add(n,n) -> math#add, add() -> math#add, helper() -> math#helper.
    //   console.log (member), readFileSync (external), unknownGlobal (unknown)
    //   all point at nothing in the model -> out of scope, excluded.
    expect(out.callsInScope).toBe(3);
    // Resolved = 2: the two add() calls. helper() is in scope but its caller
    // is module-top-level (no enclosing symbol), so no edge is emitted.
    expect(out.callsResolved).toBe(2);
  });
});
