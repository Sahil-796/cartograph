import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createProject, addSourceFiles } from "../src/project.js";
import { walkRepo } from "../src/walk.js";
import { extractSymbols } from "../src/symbols.js";
import { extractEntrypoints } from "../src/entrypoints.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Walk a fixture repo and return its files paired with a loaded project. */
function load(fixture: string) {
  const root = join(__dirname, "fixtures", fixture);
  const files = walkRepo(root);
  const project = createProject(root);
  addSourceFiles(project, files.map((f) => f.absPath));
  return { files, project };
}

describe("extractEntrypoints — Next.js app router", () => {
  const { files, project } = load("next-app");

  it("derives a PAGE entrypoint with dynamic segment and its handler symbol", () => {
    const rel = "app/users/[id]/page.tsx";
    const sf = project.getSourceFile(files.find((f) => f.relPath === rel)!.absPath)!;
    const syms = extractSymbols(sf, "repo", rel).symbols;
    const { entrypoints, handledBy } = extractEntrypoints(sf, "repo", rel, syms);

    expect(entrypoints).toContainEqual(
      expect.objectContaining({ method: "PAGE", route: "/users/:id", kind: "route" }),
    );
    expect(handledBy[0]?.symbolId).toBe(`${rel}#UserPage`);
  });

  it("derives one entrypoint per exported verb in a route.ts", () => {
    const rel = "app/users/[id]/route.ts";
    const sf = project.getSourceFile(files.find((f) => f.relPath === rel)!.absPath)!;
    const syms = extractSymbols(sf, "repo", rel).symbols;
    const { entrypoints, handledBy } = extractEntrypoints(sf, "repo", rel, syms);

    const methods = entrypoints.map((e) => e.method).sort();
    expect(methods).toEqual(["GET", "POST"]);
    expect(entrypoints.every((e) => e.route === "/users/:id")).toBe(true);
    expect(handledBy.find((h) => h.entrypointId === "GET /users/:id")?.symbolId).toBe(`${rel}#GET`);
  });
});

describe("extractEntrypoints — Express", () => {
  const { files, project } = load("express-app");
  const rel = "src/server.ts";
  const sf = project.getSourceFile(files.find((f) => f.relPath === rel)!.absPath)!;
  const syms = extractSymbols(sf, "repo", rel).symbols;
  const { entrypoints, handledBy } = extractEntrypoints(sf, "repo", rel, syms);

  it("extracts string-literal routes with method and path", () => {
    expect(entrypoints).toContainEqual(
      expect.objectContaining({ method: "GET", route: "/health", path: rel }),
    );
    expect(entrypoints).toContainEqual(
      expect.objectContaining({ method: "POST", route: "/items", path: rel }),
    );
  });

  it("resolves a named handler but leaves inline handlers unresolved", () => {
    expect(handledBy.find((h) => h.entrypointId === "POST /items")?.symbolId).toBe(`${rel}#createItem`);
    expect(handledBy.find((h) => h.entrypointId === "GET /health")?.symbolId).toBeUndefined();
  });

  it("does not over-match non-route calls (Map.get, .json)", () => {
    expect(entrypoints.map((e) => e.id).sort()).toEqual(["GET /health", "POST /items"]);
  });
});
