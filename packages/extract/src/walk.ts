import { readFileSync } from "node:fs";
import { posix, sep } from "node:path";
import fg from "fast-glob";

/**
 * A single TS/JS source file discovered under a repo root, with the
 * path-convention facts (`isTest`/`isGenerated`) already computed so
 * downstream extraction doesn't need to re-derive them.
 */
export interface WalkedFile {
  /** Absolute filesystem path. */
  absPath: string;
  /** Repo-relative path, POSIX separators (`/`), e.g. `src/foo/bar.ts`. */
  relPath: string;
  /** File extension including the leading dot, e.g. `.ts`. */
  ext: string;
  /** True when the path matches a test convention. See module doc below. */
  isTest: boolean;
  /** True when the file looks generated. See module doc below. */
  isGenerated: boolean;
}

/**
 * Directories excluded everywhere in the tree, regardless of depth:
 * dependency trees, build output, coverage reports, and VCS metadata.
 * None of these can hold hand-written source worth extracting.
 */
const EXCLUDED_DIRS = ["node_modules", "dist", "build", "coverage", ".git"];

/**
 * Finds every TypeScript/JavaScript source file under `rootDir` and
 * classifies each by test/generated convention.
 *
 * Uses `fast-glob` rather than hand-rolled `fs` recursion: it already
 * handles the exclude-directory pruning and glob-brace expansion
 * (`**\/*.{ts,tsx,js,jsx}`) correctly and efficiently, and it's a single
 * small, well-maintained dependency rather than reimplementing directory
 * walking + ignore-matching by hand.
 *
 * @param rootDir Absolute path to the repo root to walk.
 */
export function walkRepo(rootDir: string): WalkedFile[] {
  const ignore = EXCLUDED_DIRS.map((dir) => `**/${dir}/**`);

  const matches = fg.sync(["**/*.{ts,tsx,js,jsx}"], {
    cwd: rootDir,
    ignore: [...ignore, "**/*.d.ts", "**/*.min.js"],
    onlyFiles: true,
    dot: false,
    absolute: false,
  });

  return matches.map((match) => {
    // fast-glob always returns POSIX-style paths, even on Windows, but
    // normalise defensively in case the platform separator leaks in.
    const relPath = match.split(sep).join(posix.sep);
    const absPath = posix.join(rootDir.split(sep).join(posix.sep), relPath);
    const ext = posix.extname(relPath);

    return {
      absPath,
      relPath,
      ext,
      isTest: isTestPath(relPath),
      isGenerated: isGeneratedPath(relPath),
    };
  });
}

/**
 * Directory names that, as an *exact* path segment at any depth, mean the
 * file is test code. Exact-segment matching (not substring) is deliberate:
 * it catches `packages/foo/test/bar.ts` in a monorepo without over-matching
 * `src/testutils/x.ts` or `src/spectrum/y.ts`. Kept to the unambiguous,
 * cross-framework conventions (Jest/Vitest/Mocha/Nest) so classification is
 * repo-agnostic — no per-repo configuration.
 */
const TEST_DIR_SEGMENTS = new Set(["__tests__", "__test__", "test", "tests", "e2e"]);

/**
 * Test-path convention, convention-based so it holds for any TS/JS repo:
 *  - a `*.test.*` / `*.spec.*` / `*.e2e-spec.*` filename (Jest, Vitest,
 *    Mocha, Jasmine, Nest all share these), or
 *  - a test directory ({@link TEST_DIR_SEGMENTS}) as an exact segment at
 *    any depth — so both `test/foo.ts` and `packages/api/test/foo.ts` count.
 */
function isTestPath(relPath: string): boolean {
  const segments = relPath.split(posix.sep);
  const filename = segments[segments.length - 1] ?? "";

  if (/\.(test|spec|e2e-spec)\.[^./]+$/.test(filename)) return true;
  // Any segment except the filename itself.
  if (segments.slice(0, -1).some((seg) => TEST_DIR_SEGMENTS.has(seg))) return true;

  return false;
}

/**
 * Generated-file convention. Build output directories (`dist`, `build`,
 * `coverage`) are already excluded from the walk entirely (see
 * `EXCLUDED_DIRS`), so this only needs to catch generated files that
 * live alongside hand-written source, e.g. `*.generated.ts`.
 */
function isGeneratedPath(relPath: string): boolean {
  const filename = relPath.split(posix.sep).pop() ?? "";
  return /\.generated\.[^./]+$/.test(filename);
}

/**
 * Line count for a file, computed by splitting its contents on `\n`.
 * Exported so `project.ts`/the orchestrator can compute `FileNode.loc`
 * without re-implementing the split convention.
 */
export function countLines(absPath: string): number {
  const contents = readFileSync(absPath, "utf8");
  if (contents.length === 0) return 0;
  // A trailing newline shouldn't count as an extra blank line.
  const normalised = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
  return normalised.split("\n").length;
}
