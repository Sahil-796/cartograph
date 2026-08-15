import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createProject, addSourceFiles } from "../src/project.js";
import { walkRepo } from "../src/walk.js";
import { extractSymbols } from "../src/symbols.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CODE_REPO = join(__dirname, "fixtures", "code-repo");

describe("extractSymbols", () => {
  const files = walkRepo(CODE_REPO);
  const project = createProject(CODE_REPO);
  addSourceFiles(project, files.map((f) => f.absPath));

  const mathFile = files.find((f) => f.relPath === "src/math.ts")!;
  const sf = project.getSourceFile(mathFile.absPath)!;
  const { symbols, defines } = extractSymbols(sf, "repo", "src/math.ts");
  const byName = new Map(symbols.map((s) => [s.name, s]));

  it("captures functions, classes, consts, and arrow bindings", () => {
    expect(byName.get("add")?.kind).toBe("function");
    expect(byName.get("double")?.kind).toBe("arrow");
    expect(byName.get("VERSION")?.kind).toBe("const");
  });

  it("distinguishes exported from non-exported symbols", () => {
    expect(byName.get("add")?.exported).toBe(true);
    expect(byName.get("helper")?.exported).toBe(false);
  });

  it("uses ${path}#${name} ids and 1-based lines", () => {
    expect(byName.get("add")?.id).toBe("src/math.ts#add");
    expect(byName.get("add")?.line).toBe(1);
  });

  it("emits one DefinesEdge per symbol", () => {
    expect(defines).toHaveLength(symbols.length);
    expect(defines.every((d) => d.filePath === "src/math.ts")).toBe(true);
    expect(defines.map((d) => d.symbolId)).toContain("src/math.ts#add");
  });
});
