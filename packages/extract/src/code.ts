import { isAbsolute, relative, resolve as resolvePath } from "node:path";
import { posix } from "node:path";
import { ts, type Project, type SourceFile } from "ts-morph";
import type {
  CallsEdge,
  DefinesEdge,
  EntrypointNode,
  HandledByEdge,
  ImportsEdge,
  SymbolNode,
} from "./payload.js";
import { extractSymbols } from "./symbols.js";
import {
  buildImportMap,
  createResolver,
  extractImports,
  type PathAliases,
} from "./imports.js";
import { extractCalls } from "./calls.js";
import { extractEntrypoints } from "./entrypoints.js";
import type { WalkedFile } from "./walk.js";

/** The code-derived slice of a `GraphPayload`, plus the raw call metrics. */
export interface CodeExtraction {
  symbols: SymbolNode[];
  defines: DefinesEdge[];
  imports: ImportsEdge[];
  calls: CallsEdge[];
  entrypoints: EntrypointNode[];
  handledBy: HandledByEdge[];
  /** Call sites that produced an edge. */
  callsResolved: number;
  /** Resolution-rate denominator: calls whose callee is a known in-repo symbol. */
  callsInScope: number;
  /** Every call site observed, raw (reported alongside the rate). */
  callsObserved: number;
}

/**
 * Runs the four AST extractors over every walked file and aggregates them
 * into the code portion of the graph payload.
 *
 * The symbol index is built in a first pass over ALL files before any
 * import or call resolution runs, because call resolution is inherently
 * cross-file: a call in file A to a symbol imported from file B can only be
 * resolved once B's symbols are known. Everything keys off `WalkedFile.
 * relPath` (repo-relative POSIX) so the payload never leaks absolute paths.
 *
 * @param project ts-morph project; source files must already be added by
 *   the caller (via `addSourceFiles`).
 * @param files The walked files to extract, paired 1:1 with source files.
 * @param repoId The owning `RepoNode.id`.
 */
export function extractCode(
  project: Project,
  files: WalkedFile[],
  repoId: string,
): CodeExtraction {
  // Pair each walked file with its parsed SourceFile; skip any the project
  // didn't load (defensive — the caller is expected to have added them all).
  const paired: { file: WalkedFile; sourceFile: SourceFile }[] = [];
  for (const file of files) {
    const sourceFile = project.getSourceFile(file.absPath);
    if (sourceFile) paired.push({ file, sourceFile });
  }

  const repoFiles = new Set(paired.map((p) => p.file.relPath));
  const aliases = readPathAliases(files);
  const resolve = createResolver(repoFiles, aliases);

  // Pass 1 — symbols. Build the cross-file index everything else joins on.
  const symbols: SymbolNode[] = [];
  const defines: DefinesEdge[] = [];
  const knownSymbolIds = new Set<string>();
  const perFile = new Map<string, { names: Set<string>; symbols: SymbolNode[] }>();

  for (const { file, sourceFile } of paired) {
    const res = extractSymbols(sourceFile, repoId, file.relPath);
    symbols.push(...res.symbols);
    defines.push(...res.defines);
    const names = new Set<string>();
    for (const s of res.symbols) {
      knownSymbolIds.add(s.id);
      names.add(s.name);
    }
    perFile.set(file.relPath, { names, symbols: res.symbols });
  }

  // Pass 2 — imports, calls, entrypoints (all depend on the symbol index).
  const imports: ImportsEdge[] = [];
  const calls: CallsEdge[] = [];
  const entrypoints: EntrypointNode[] = [];
  const handledBy: HandledByEdge[] = [];
  let callsResolved = 0;
  let callsInScope = 0;
  let callsObserved = 0;

  for (const { file, sourceFile } of paired) {
    const local = perFile.get(file.relPath)!;

    // Imports are extracted for every file, tests included: "which test
    // files import this module" is a fact worth keeping (it's how the
    // product shows a file's tests).
    imports.push(...extractImports(sourceFile, repoId, file.relPath, resolve));

    // The call graph and entrypoints model the *application's* structure,
    // so test files are excluded from them (and therefore from the
    // resolution metric). This is driven purely by the convention-based
    // `isTest` flag, so it holds for any repo — test code, whose calls sit
    // inside `it(() => ...)` callbacks with no top-level owner, no longer
    // drags the honest metric down. Test files remain File nodes with their
    // imports; only their internal call graph is omitted.
    if (file.isTest) continue;

    const importMap = buildImportMap(sourceFile, file.relPath, resolve);
    const callRes = extractCalls(
      sourceFile,
      repoId,
      file.relPath,
      importMap,
      local.names,
      knownSymbolIds,
    );
    calls.push(...callRes.calls);
    callsResolved += callRes.callsResolved;
    callsInScope += callRes.callsInScope;
    callsObserved += callRes.callsObserved;

    const entry = extractEntrypoints(sourceFile, repoId, file.relPath, local.symbols);
    entrypoints.push(...entry.entrypoints);
    handledBy.push(...entry.handledBy);
  }

  return {
    symbols,
    defines,
    imports,
    calls,
    entrypoints,
    handledBy,
    callsResolved,
    callsInScope,
    callsObserved,
  };
}

/**
 * Reads tsconfig `paths` aliases from the target repo, if a `tsconfig.json`
 * exists at its root. Uses the TypeScript compiler's own config parser (via
 * ts-morph's bundled `ts`) so `extends`, JSONC comments, and `baseUrl` are
 * all handled correctly; alias targets are rewritten to repo-relative POSIX
 * prefixes so the resolver can membership-test them against walked files.
 * Any failure (no config, unreadable, no `paths`) yields an empty map — the
 * resolver then simply handles relative specifiers only.
 */
function readPathAliases(files: WalkedFile[]): PathAliases {
  const rootDir = repoRootOf(files);
  if (!rootDir) return new Map();

  try {
    const configPath = posix.join(rootDir, "tsconfig.json");
    if (!ts.sys.fileExists(configPath)) return new Map();

    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) return new Map();
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, rootDir);

    const paths = parsed.options.paths;
    if (!paths) return new Map();
    const baseUrl = parsed.options.baseUrl ?? rootDir;

    const aliases = new Map<string, string[]>();
    for (const [alias, targets] of Object.entries(paths)) {
      const repoRelTargets = targets.map((t) => {
        const noStar = t.endsWith("/*") ? t.slice(0, -2) : t;
        const abs = isAbsolute(noStar) ? noStar : resolvePath(baseUrl, noStar);
        return toPosix(relative(rootDir, abs));
      });
      aliases.set(alias, repoRelTargets);
    }
    return aliases;
  } catch {
    return new Map();
  }
}

/**
 * Recovers the repo root by stripping a file's `relPath` off its `absPath`
 * (both produced by the same `walkRepo` call, so `absPath` ends with
 * `"/" + relPath`). Returns `undefined` when there are no files.
 */
function repoRootOf(files: WalkedFile[]): string | undefined {
  const first = files[0];
  if (!first) return undefined;
  const suffix = "/" + first.relPath;
  return first.absPath.endsWith(suffix)
    ? first.absPath.slice(0, -suffix.length)
    : posix.dirname(first.absPath);
}

/** Normalise a possibly-Windows path to POSIX separators. */
function toPosix(p: string): string {
  return p.split(/[\\/]/).join(posix.sep);
}
