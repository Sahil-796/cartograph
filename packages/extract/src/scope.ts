import { Node } from "ts-morph";

/**
 * Symbol identity for declarations at ANY nesting depth.
 *
 * The original extractor recorded only file-top-level declarations, keyed
 * `${path}#${name}`. That id scheme cannot name a nested function or a class
 * method without colliding: two classes can each declare `render`, and two
 * functions can each declare a local `helper`. This module solves that by
 * qualifying an id with the chain of *named enclosing scopes* — so a method
 * `run` on class `Worker` becomes `Worker.run`, and a function
 * `runClaimedStep` nested in `createWorker` becomes `createWorker.runClaimedStep`.
 *
 * The invariant that keeps this backwards-compatible: a top-level declaration
 * has an EMPTY scope chain, so `qualify("", "foo") === "foo"` and its id stays
 * exactly `${path}#foo`. Every id minted before this change is unchanged; only
 * newly-captured nested symbols get a dotted qualifier.
 *
 * The human-facing `name` is always the plain declared identifier
 * (`runClaimedStep`), never the qualifier — search matches on `name`, so a
 * nested symbol is still findable by its simple name; the qualifier lives only
 * in the collision-proof `id`.
 */

/**
 * The dot-joined names of the named scopes enclosing `node` (outermost →
 * innermost), excluding `node` itself. Returns `""` for a file-top-level node.
 *
 * Only *named* scopes contribute a segment: function/class/method declarations
 * by their name, and a variable/property declaration whose initializer is the
 * function we're inside (so `const createWorker = () => { function f(){} }`
 * qualifies `f` as `createWorker.f`). Anonymous scopes (bare blocks, arrow
 * functions with no binding, `if`/`for` bodies) contribute nothing, keeping
 * ids stable against reformatting that only adds/removes such wrappers.
 */
export function scopeChain(node: Node): string {
  const parts: string[] = [];
  let cur: Node | undefined = node.getParent();
  while (cur && !Node.isSourceFile(cur)) {
    const seg = scopeSegment(cur);
    if (seg) parts.unshift(seg);
    cur = cur.getParent();
  }
  return parts.join(".");
}

/** The name a single AST node contributes to a scope chain, or `undefined`. */
function scopeSegment(node: Node): string | undefined {
  if (Node.isFunctionDeclaration(node)) return node.getName();
  if (Node.isClassDeclaration(node)) return node.getName();
  if (Node.isMethodDeclaration(node)) return node.getName();
  // `const foo = () => {...}` / `foo = function () {...}`: the arrow/function
  // is anonymous, but the binding it's assigned to names the scope.
  if (Node.isVariableDeclaration(node)) return node.getName();
  if (Node.isPropertyDeclaration(node)) return node.getName();
  return undefined;
}

/** Joins a scope chain and a declared name into a qualified symbol name. */
export function qualify(scope: string, name: string): string {
  return scope ? `${scope}.${name}` : name;
}

/** The full `${path}#${qualifiedName}` id for a declaration named `name`. */
export function qualifiedId(relPath: string, scope: string, name: string): string {
  return `${relPath}#${qualify(scope, name)}`;
}
