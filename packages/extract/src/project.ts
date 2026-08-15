import { Project } from "ts-morph";

/**
 * Builds a ts-morph `Project` tuned for fast, isolated static analysis of
 * an arbitrary target repo — not for type-checking it.
 *
 * The three settings below are what keep this to seconds rather than
 * minutes on a real-sized repo:
 *
 * - `skipAddingFilesFromTsConfig: true` — even though we pass a
 *   `tsConfigFilePath` is intentionally *not* used at all here; we add
 *   source files ourselves via `addSourceFiles` from the exact list
 *   `walkRepo` already computed. Letting ts-morph resolve a tsconfig's
 *   `include`/`references` would re-walk the filesystem and could pull
 *   in files we deliberately excluded (tests, generated files handled
 *   elsewhere, etc.).
 * - `skipFileDependencyResolution: true` — stops ts-morph from
 *   following every `import` it finds out to disk to load *its* target
 *   too. We only care about the files inside the target repo that
 *   `walkRepo` already found; dependency resolution would otherwise
 *   pull in the entire `node_modules` tree just to satisfy type
 *   references.
 * - No `lib` files — the default `compilerOptions` below omits `lib`
 *   entirely (and does not point at a real `tsconfig.json`), so
 *   ts-morph never loads the TypeScript standard library `.d.ts` files.
 *   We only need syntactic/structural AST access (function names,
 *   classes, call expressions, imports) — not full type-checking — so
 *   paying to parse `lib.es2022.d.ts` and friends on every run buys us
 *   nothing.
 *
 * Together these make `createProject` a purely in-memory, disk-scoped
 * parser: it parses exactly the files it's given, and nothing else.
 *
 * @param rootDir Absolute path to the repo root being analyzed. Not used
 *   to resolve a tsconfig — kept as a parameter for callers who want to
 *   pass it through for logging/diagnostics, and for symmetry with
 *   `walkRepo(rootDir)`.
 */
export function createProject(_rootDir: string): Project {
  return new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: false,
    compilerOptions: {
      allowJs: true,
      lib: [],
      types: [],
    },
  });
}

/**
 * Adds the given absolute file paths to `project` as source files.
 *
 * Kept as a thin, separate helper (rather than inlined at each call
 * site) so the orchestrator can hand it the exact `absPath` list
 * produced by `walkRepo` without re-deriving anything.
 *
 * @param project A `Project` created by `createProject`.
 * @param absPaths Absolute paths of files to add (e.g. `WalkedFile.absPath`).
 */
export function addSourceFiles(project: Project, absPaths: readonly string[]): void {
  for (const absPath of absPaths) {
    project.addSourceFileAtPath(absPath);
  }
}
