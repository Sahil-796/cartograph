import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractRepo } from "../src/extract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CODE_REPO = join(__dirname, "fixtures", "code-repo");

describe("extractRepo (end-to-end composition)", () => {
  // The fixture is not a git repo; history is disabled so the run is
  // hermetic and exercises the graceful no-history path.
  it("assembles a complete GraphPayload from a folder", async () => {
    const payload = await extractRepo(CODE_REPO, {
      repoId: "code-repo",
      history: false,
    });

    // Repo identity.
    expect(payload.repo).toEqual({ id: "code-repo", name: "code-repo" });

    // Files discovered and stamped with the repo id + a real line count.
    const paths = payload.files.map((f) => f.path).sort();
    expect(paths).toEqual(["src/main.ts", "src/math.ts"]);
    expect(payload.files.every((f) => f.repoId === "code-repo")).toBe(true);
    expect(payload.files.find((f) => f.path === "src/math.ts")!.loc).toBeGreaterThan(0);

    // Code facts wired through from extractCode.
    expect(payload.symbols.map((s) => s.id)).toContain("src/math.ts#add");
    expect(payload.calls).toContainEqual({
      repoId: "code-repo",
      fromSymbolId: "src/main.ts#run",
      toSymbolId: "src/math.ts#add",
    });
    expect(payload.imports).toContainEqual({
      repoId: "code-repo",
      fromPath: "src/main.ts",
      toPath: "src/math.ts",
    });

    // History was skipped cleanly — empty, not undefined.
    expect(payload.commits).toEqual([]);
    expect(payload.authors).toEqual([]);
    expect(payload.coChanged).toEqual([]);

    // Honest metric: 6 observed, 3 in scope, 2 resolved → rate 2/3.
    expect(payload.stats).toEqual({
      callsObserved: 6,
      callsInScope: 3,
      callsResolved: 2,
      callResolutionRate: 2 / 3,
    });
  });
});
