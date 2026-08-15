import { Node, type SourceFile, type VariableDeclaration } from "ts-morph";
import type { DefinesEdge, SymbolNode } from "./payload.js";

/**
 * Extracts the top-level named declarations from a single source file and
 * the `File → Symbol` edges that record where each was defined.
 *
 * "Top-level" is taken strictly: only declarations whose container is the
 * file itself (function/class declarations, and `const`/`let`/`var`
 * bindings in a top-level variable statement). We deliberately do NOT
 * descend into class bodies, nested functions, or block scopes — the
 * contract is file- and top-level-symbol-level only, and a method or a
 * closure is not independently addressable by the `${path}#${name}` id
 * scheme (two classes could each declare a `render` method, colliding).
 *
 * Only declarations with a discoverable name are emitted; an anonymous
 * `export default () => {}` has no stable id and is skipped rather than
 * guessed.
 *
 * @param sourceFile ts-morph SourceFile already added to the project.
 * @param repoId The owning `RepoNode.id`, copied onto every node/edge.
 * @param relPath Repo-relative POSIX path of this file (from `WalkedFile`).
 */
export function extractSymbols(
  sourceFile: SourceFile,
  repoId: string,
  relPath: string,
): { symbols: SymbolNode[]; defines: DefinesEdge[] } {
  const symbols: SymbolNode[] = [];

  // The authoritative set of names this file exports, including names made
  // visible only via a separate `export { foo }` statement (which leaves no
  // `export` keyword on the declaration itself). `getExportedDeclarations`
  // keys are export *names* — a default export keyed as `"default"`, which
  // we combine with per-declaration `isDefaultExport()` below.
  const exportedNames = new Set(sourceFile.getExportedDeclarations().keys());

  const isExported = (
    decl: { isExported(): boolean; isDefaultExport(): boolean },
    name: string,
  ): boolean => decl.isExported() || decl.isDefaultExport() || exportedNames.has(name);

  const push = (name: string, kind: SymbolNode["kind"], line: number, exported: boolean) => {
    symbols.push({
      repoId,
      id: `${relPath}#${name}`,
      name,
      kind,
      path: relPath,
      line,
      exported,
    });
  };

  // Top-level function declarations: `function foo() {}` (incl. exported and
  // default-exported forms). `getFunctions()` only returns file-level ones.
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name) continue; // anonymous `export default function () {}` — no id
    push(name, "function", fn.getStartLineNumber(), isExported(fn, name));
  }

  // Top-level class declarations.
  for (const cls of sourceFile.getClasses()) {
    const name = cls.getName();
    if (!name) continue;
    push(name, "class", cls.getStartLineNumber(), isExported(cls, name));
  }

  // Top-level variable bindings: `const x = ...`, including arrow functions
  // assigned to a binding (`const handler = () => {}`), which we tag `arrow`
  // so callers can tell a callable const from a plain value const.
  for (const stmt of sourceFile.getVariableStatements()) {
    const exported = stmt.isExported();
    for (const decl of stmt.getDeclarations()) {
      const name = decl.getName();
      if (!name) continue; // destructuring patterns have no single name — skip
      const kind = isArrowBinding(decl) ? "arrow" : "const";
      push(name, kind, decl.getStartLineNumber(), exported || exportedNames.has(name));
    }
  }

  const defines: DefinesEdge[] = symbols.map((s) => ({
    repoId,
    filePath: relPath,
    symbolId: s.id,
  }));

  return { symbols, defines };
}

/**
 * True when a variable declaration's initializer is an arrow function, e.g.
 * `const f = () => {}`. A plain `FunctionExpression` (`const f = function
 * () {}`) is intentionally NOT counted here: it's still a callable const,
 * but the contract's `arrow` kind names the arrow form specifically, so we
 * keep the distinction honest and let function-expression consts fall
 * through to the generic `const` kind.
 */
function isArrowBinding(decl: VariableDeclaration): boolean {
  const init = decl.getInitializer();
  return init !== undefined && Node.isArrowFunction(init);
}
