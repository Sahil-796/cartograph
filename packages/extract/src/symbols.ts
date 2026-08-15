import { Node, type SourceFile, type VariableDeclaration } from "ts-morph";
import type { DefinesEdge, SymbolNode } from "./payload.js";
import { scopeChain, qualify } from "./scope.js";

/**
 * Extracts the named declarations from a single source file and the
 * `File → Symbol` edges that record where each was defined.
 *
 * Scope: named declarations at ANY nesting depth —
 *   - function declarations, top-level AND nested (`function runClaimedStep`
 *     defined inside `createWorker`);
 *   - class declarations;
 *   - class methods, both `method() {}` and arrow/function class properties
 *     (`handle = () => {}`);
 *   - top-level `const`/`let`/`var` bindings (incl. arrow-function consts).
 *
 * A nested function or a method is made independently addressable by
 * *qualifying* its id with the chain of enclosing named scopes (see
 * `scope.ts`): `createWorker.runClaimedStep`, `Worker.run`. Two classes each
 * declaring `render` therefore get distinct ids `A.render` / `B.render`
 * instead of colliding. A file-top-level declaration has an empty scope chain,
 * so its id stays exactly `${path}#${name}` — unchanged from before this walk
 * existed. The `name` field is always the plain identifier, so a nested symbol
 * is still findable by its simple name via search.
 *
 * What is deliberately still NOT captured: nested `const`/arrow bindings inside
 * a function body (local callback helpers — high volume, low value), anonymous
 * functions with no binding, and destructured bindings. See docs/limitations.md.
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

  // `name` is the plain declared identifier (used for display + search);
  // `scope` qualifies the id so nested/method symbols never collide. A
  // top-level declaration passes `scope === ""`, keeping its historical id.
  const push = (
    name: string,
    scope: string,
    kind: SymbolNode["kind"],
    line: number,
    exported: boolean,
  ) => {
    symbols.push({
      repoId,
      id: `${relPath}#${qualify(scope, name)}`,
      name,
      kind,
      path: relPath,
      line,
      exported,
    });
  };

  // A single descendant walk captures declarations at every depth. Top-level
  // forms get an empty scope chain (unchanged ids); nested forms get a dotted
  // qualifier. Only a *module-top* function/class is treated as potentially
  // exported — a nested function or a method is internal to its enclosing
  // scope and never a module export.
  sourceFile.forEachDescendant((node) => {
    if (Node.isFunctionDeclaration(node)) {
      const name = node.getName();
      if (!name) return; // anonymous `export default function () {}` — no id
      const scope = scopeChain(node);
      push(name, scope, "function", node.getStartLineNumber(), scope === "" && isExported(node, name));
    } else if (Node.isClassDeclaration(node)) {
      const name = node.getName();
      if (!name) return;
      const scope = scopeChain(node);
      push(name, scope, "class", node.getStartLineNumber(), scope === "" && isExported(node, name));
    } else if (Node.isMethodDeclaration(node)) {
      const name = node.getName();
      if (!name) return;
      push(name, scopeChain(node), "method", node.getStartLineNumber(), false);
    } else if (Node.isPropertyDeclaration(node)) {
      // Class field holding a function value: `handle = () => {}` /
      // `handle = function () {}` — a method in all but syntax.
      const init = node.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        const name = node.getName();
        if (!name) return;
        push(name, scopeChain(node), "method", node.getStartLineNumber(), false);
      }
    }
  });

  // Top-level variable bindings: `const x = ...`, including arrow functions
  // assigned to a binding (`const handler = () => {}`), which we tag `arrow`
  // so callers can tell a callable const from a plain value const. Only
  // module-top statements are taken (nested local consts are out of scope).
  for (const stmt of sourceFile.getVariableStatements()) {
    const exported = stmt.isExported();
    for (const decl of stmt.getDeclarations()) {
      const name = decl.getName();
      if (!name) continue; // destructuring patterns have no single name — skip
      const kind = isArrowBinding(decl) ? "arrow" : "const";
      push(name, "", kind, decl.getStartLineNumber(), exported || exportedNames.has(name));
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
