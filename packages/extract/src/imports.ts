import { posix } from "node:path";
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import type { ImportsEdge } from "./payload.js";

/**
 * Resolves a module specifier written in `fromRelPath` to the repo-relative
 * POSIX path of the file it refers to, or `undefined` when the target is
 * not a file in this repo (a bare package like `react`, or a relative path
 * that doesn't exist). See {@link createResolver}.
 */
export type ModuleResolver = (fromRelPath: string, specifier: string) => string | undefined;

/** File extensions tried, in order, when a specifier omits its extension. */
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;

/**
 * A tsconfig `paths` alias table, already reduced to what we need: each
 * alias prefix (with any trailing `/*` stripped) maps to its list of target
 * prefixes (again `/*`-stripped), all relative to the repo root.
 */
export type PathAliases = ReadonlyMap<string, readonly string[]>;

/**
 * Builds a resolver closed over the set of files that actually exist in the
 * repo (their repo-relative POSIX paths) and, optionally, tsconfig `paths`
 * aliases. Resolution is purely lexical + membership-tested against
 * `repoFiles`: we never touch the filesystem, and we only ever return a
 * path we can prove is in the repo — an unresolvable or external specifier
 * yields `undefined` (a dropped edge), never a guess.
 *
 * Relative specifiers are resolved against the importing file's directory,
 * trying, in order: the literal path, then each of `.ts/.tsx/.js/.jsx`,
 * then `index.*` inside it (directory import). Alias specifiers are first
 * rewritten through `pathAliases`, then run through the same relative
 * machinery from the repo root.
 */
export function createResolver(
  repoFiles: ReadonlySet<string>,
  pathAliases: PathAliases = new Map(),
): ModuleResolver {
  const tryPath = (candidate: string): string | undefined => {
    // Normalise `./a/../b` etc. `posix.normalize` keeps a leading `../` if
    // the path escapes the root; such a path can't be in `repoFiles`, so it
    // simply fails membership below.
    const norm = posix.normalize(candidate);
    if (repoFiles.has(norm)) return norm;
    for (const ext of EXTENSIONS) {
      if (repoFiles.has(norm + ext)) return norm + ext;
    }
    for (const ext of EXTENSIONS) {
      const indexed = posix.join(norm, `index${ext}`);
      if (repoFiles.has(indexed)) return indexed;
    }
    return undefined;
  };

  return (fromRelPath, specifier) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const baseDir = posix.dirname(fromRelPath);
      return tryPath(posix.join(baseDir, specifier));
    }

    // tsconfig alias: find the longest matching alias prefix and rewrite.
    for (const [alias, targets] of pathAliases) {
      const rest = matchAlias(specifier, alias);
      if (rest === undefined) continue;
      for (const target of targets) {
        const resolved = tryPath(rest ? posix.join(target, rest) : target);
        if (resolved) return resolved;
      }
    }

    // Anything else is a bare package specifier — external, not in the model.
    return undefined;
  };
}

/**
 * If `specifier` is covered by `alias` (either an exact match, or `alias`
 * ended in `/*` and `specifier` starts with the prefix), returns the
 * captured remainder (`""` for an exact match); otherwise `undefined`.
 */
function matchAlias(specifier: string, alias: string): string | undefined {
  if (alias.endsWith("/*")) {
    const prefix = alias.slice(0, -2);
    if (specifier === prefix) return "";
    if (specifier.startsWith(prefix + "/")) return specifier.slice(prefix.length + 1);
    return undefined;
  }
  return specifier === alias ? "" : undefined;
}

/**
 * Every static way a file names another module: `import ... from "x"`,
 * `export ... from "x"`, bare `import "x"`, and CommonJS `require("x")`.
 * Each carries the specifier plus, for `import`s, the local binding info
 * needed to build the call-resolution import map.
 */
interface ModuleRef {
  specifier: string;
  /** Named bindings: local name → the name as exported by the target. */
  named: { localName: string; importedName: string }[];
  /** Local name of a default import (`import x from "y"`), if any. */
  defaultLocal?: string;
  /** Local name of a namespace import (`import * as ns from "y"`), if any. */
  namespaceLocal?: string;
}

/**
 * Collects every module reference in a file. Factored out so both
 * {@link extractImports} (which only needs specifiers) and
 * {@link buildImportMap} (which needs the binding names) walk the AST once,
 * consistently.
 */
function collectModuleRefs(sourceFile: SourceFile): ModuleRef[] {
  const refs: ModuleRef[] = [];

  for (const decl of sourceFile.getImportDeclarations()) {
    const named = decl.getNamedImports().map((n) => ({
      localName: (n.getAliasNode() ?? n.getNameNode()).getText(),
      importedName: n.getName(),
    }));
    refs.push({
      specifier: decl.getModuleSpecifierValue(),
      named,
      defaultLocal: decl.getDefaultImport()?.getText(),
      namespaceLocal: decl.getNamespaceImport()?.getText(),
    });
  }

  // `export { foo } from "./x"` / `export * from "./x"`: an import edge, but
  // it introduces no local binding, so nothing for the import map.
  for (const decl of sourceFile.getExportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (specifier) refs.push({ specifier, named: [] });
  }

  // CommonJS `require("x")` — capture the specifier for the import edge.
  // `const x = require("y")` binding wiring is out of scope for the import
  // map (CJS default-object semantics are ambiguous for symbol resolution).
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!Node.isIdentifier(expr) || expr.getText() !== "require") continue;
    const [arg] = call.getArguments();
    if (arg && Node.isStringLiteral(arg)) {
      refs.push({ specifier: arg.getLiteralValue(), named: [] });
    }
  }

  return refs;
}

/**
 * Emits one `File → File` import edge per module reference that resolves to
 * a file in this repo. Bare/external and unresolvable specifiers are
 * dropped. Duplicate `(fromPath, toPath)` pairs (e.g. two imports from the
 * same file) are collapsed — the edge is a boolean fact, not a count.
 */
export function extractImports(
  sourceFile: SourceFile,
  repoId: string,
  relPath: string,
  resolve: ModuleResolver,
): ImportsEdge[] {
  const seen = new Set<string>();
  const edges: ImportsEdge[] = [];

  for (const ref of collectModuleRefs(sourceFile)) {
    const toPath = resolve(relPath, ref.specifier);
    if (!toPath || toPath === relPath) continue; // unresolved, external, or self
    if (seen.has(toPath)) continue;
    seen.add(toPath);
    edges.push({ repoId, fromPath: relPath, toPath });
  }

  return edges;
}

/**
 * How a local name in a file traces back to a symbol in another file.
 * `importedName` is the name as the *target* file exports it, so call
 * resolution can form the candidate id `${targetPath}#${importedName}`.
 * `"default"` / `"*"` mark default and namespace imports respectively:
 * their concrete target symbol name isn't known from the import alone, so
 * call resolution treats them specially (namespace members can still be
 * resolved by property name; a bare default import cannot).
 */
export interface ImportBinding {
  targetPath: string;
  importedName: string;
}

/** Local-name → {@link ImportBinding} for a single file. */
export type ImportMap = ReadonlyMap<string, ImportBinding>;

/**
 * Builds the import map that {@link import("./calls.js")} uses to resolve
 * imported callees. Only bindings whose module resolves to a repo file are
 * included — an unresolved import can never produce a valid symbol id.
 */
export function buildImportMap(
  sourceFile: SourceFile,
  relPath: string,
  resolve: ModuleResolver,
): ImportMap {
  const map = new Map<string, ImportBinding>();

  for (const ref of collectModuleRefs(sourceFile)) {
    const targetPath = resolve(relPath, ref.specifier);
    if (!targetPath) continue;

    for (const { localName, importedName } of ref.named) {
      map.set(localName, { targetPath, importedName });
    }
    if (ref.defaultLocal) {
      map.set(ref.defaultLocal, { targetPath, importedName: "default" });
    }
    if (ref.namespaceLocal) {
      map.set(ref.namespaceLocal, { targetPath, importedName: "*" });
    }
  }

  return map;
}
