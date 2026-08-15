import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createProject, addSourceFiles } from "../src/project.js";
import { walkRepo } from "../src/walk.js";
import { extractCode } from "../src/code.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NESTED_REPO = join(__dirname, "fixtures", "nested-repo");

describe("nested symbols (full-tree walk)", () => {
  const files = walkRepo(NESTED_REPO);
  const project = createProject(NESTED_REPO);
  addSourceFiles(project, files.map((f) => f.absPath));
  const out = extractCode(project, files, "repo");

  const byId = new Map(out.symbols.map((s) => [s.id, s]));
  const byName = new Map(out.symbols.map((s) => [s.name, s]));

  it("captures class methods with qualified ids and kind method", () => {
    const run = byId.get("src/main.ts#Worker.run");
    expect(run?.kind).toBe("method");
    expect(run?.name).toBe("run");
    expect(run?.exported).toBe(false);
    expect(byId.get("src/main.ts#Worker.step")?.kind).toBe("method");
  });

  it("captures nested functions with qualified ids but simple names", () => {
    const nested = byId.get("src/main.ts#createWorker.runClaimedStep");
    expect(nested?.kind).toBe("function");
    expect(nested?.name).toBe("runClaimedStep");
    expect(nested?.exported).toBe(false);
    // Top-level ids stay unchanged.
    expect(byId.get("src/main.ts#createWorker")?.id).toBe("src/main.ts#createWorker");
    expect(byId.get("src/main.ts#Worker")?.kind).toBe("class");
  });

  it("keeps nested symbols searchable by their plain name", () => {
    expect(byName.get("runClaimedStep")?.id).toBe("src/main.ts#createWorker.runClaimedStep");
    expect(byName.get("run")?.id).toBe("src/main.ts#Worker.run");
  });

  it("resolves this.method() within a class", () => {
    expect(out.calls).toContainEqual({
      repoId: "repo",
      fromSymbolId: "src/main.ts#Worker.run",
      toSymbolId: "src/main.ts#Worker.step",
    });
  });

  it("resolves a bare call to a lexically-visible nested function", () => {
    expect(out.calls).toContainEqual({
      repoId: "repo",
      fromSymbolId: "src/main.ts#createWorker",
      toSymbolId: "src/main.ts#createWorker.runClaimedStep",
    });
  });
});
