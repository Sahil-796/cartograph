import { Node, SyntaxKind, type CallExpression, type SourceFile } from "ts-morph";
import type { CallsEdge } from "./payload.js";
import type { ImportMap } from "./imports.js";

/**
 * Result of walking one file's call sites. `callsTotal` counts *every*
 * `CallExpression` observed (the honest denominator, including calls we
 * can't attribute or resolve); `callsResolved` counts those that produced
 * a `Symbol → Symbol` edge. Their ratio is the extractor's headline
 * quality metric.
 */
export interface CallExtraction {
  calls: CallsEdge[];
  /** Call sites that produced a `Symbol → Symbol` edge. */
  callsResolved: number;
  /**
   * The honest denominator: call sites whose *callee* resolves to a known
   * in-repo symbol — i.e. calls we actually attempt to trace. A resolved
   * call can still fail to become an edge if its *caller* is module-top
   * (no enclosing symbol); those count here but not in `callsResolved`.
   * Excludes out-of-scope shapes entirely: method/property calls
   * (`obj.m()`), calls into external packages, and unknown globals — none
   * of which point at anything in the model, so counting them would
   * conflate "out of scope" with "failed to resolve".
   */
  callsInScope: number;
  /**
   * Every `CallExpression` observed, raw — reported for honesty so the
   * in-scope rate can't hide how much of the code is method/library calls
   * the model doesn't trace. Not the resolution-rate denominator.
   */
  callsObserved: number;
}

/**
 * Extracts `Symbol → Symbol` call edges from a single file.
 *
 * For every call site we attempt two independent resolutions, and emit an
 * edge only when BOTH succeed unambiguously:
 *
 *  1. **Caller** (`fromSymbolId`) — the nearest enclosing top-level symbol
 *     (function, class, or const/arrow binding). A call at module top level
 *     has no such symbol; per the contract we skip it (it still counts
 *     toward `callsTotal`), rather than inventing a synthetic module owner.
 *  2. **Callee** (`toSymbolId`) — resolved to a *known* `SymbolNode.id`
 *     via, in order: the file's import map (`imported name → target file`,
 *     then that file's exported symbol of that name), a namespace-import
 *     member access (`ns.foo()` → `${target}#foo`), and finally a
 *     same-file top-level symbol of that name.
 *
 * Anything we can't tie to a single known symbol is SKIPPED and left
 * unresolved — a missing edge is fine, a wrong edge is a bug. Only bare
 * `foo()` and namespace `ns.foo()` shapes are considered; instance/method
 * calls (`obj.method()`, `this.x()`) are inherently ambiguous at this
 * granularity and are never guessed.
 *
 * @param importMap Local-name → import binding for this file.
 * @param localSymbolNames Names of this file's own top-level symbols.
 * @param knownSymbolIds Every `SymbolNode.id` in the repo, for membership
 *   testing so we only emit edges pointing at a symbol that truly exists.
 */
export function extractCalls(
  sourceFile: SourceFile,
  repoId: string,
  relPath: string,
  importMap: ImportMap,
  localSymbolNames: ReadonlySet<string>,
  knownSymbolIds: ReadonlySet<string>,
): CallExtraction {
  const calls: CallsEdge[] = [];
  let callsObserved = 0;
  let callsInScope = 0;

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    callsObserved++;

    // Callee first: does this call even point at something in the model?
    // If not (method call, external package, unknown global), it is out of
    // scope and never enters the resolution-rate denominator.
    const toSymbolId = resolveCallee(call, relPath, importMap, localSymbolNames, knownSymbolIds);
    if (!toSymbolId) continue;
    callsInScope++;

    // In-scope target, but the caller may be a module-top-level call with
    // no enclosing top-level symbol to attribute the edge to. That counts
    // against the rate (in scope, unresolved) rather than being skipped.
    const fromSymbolId = findEnclosingSymbolId(call, relPath, localSymbolNames);
    if (!fromSymbolId) continue;

    calls.push({ repoId, fromSymbolId, toSymbolId });
  }

  return { calls, callsResolved: calls.length, callsInScope, callsObserved };
}

/**
 * Walks up from a call to the nearest enclosing top-level declaration that
 * corresponds to a recorded symbol, returning its `${relPath}#${name}` id.
 * "Top-level" means the declaration's container is the file itself, so a
 * call inside a nested function or a class method is attributed to the
 * enclosing top-level function/class — never to the un-addressable inner
 * scope. Returns `undefined` for calls that sit at module top level.
 */
function findEnclosingSymbolId(
  call: CallExpression,
  relPath: string,
  localSymbolNames: ReadonlySet<string>,
): string | undefined {
  for (const anc of call.getAncestors()) {
    let name: string | undefined;

    if (Node.isFunctionDeclaration(anc) && Node.isSourceFile(anc.getParent())) {
      name = anc.getName();
    } else if (Node.isClassDeclaration(anc) && Node.isSourceFile(anc.getParent())) {
      name = anc.getName();
    } else if (Node.isVariableDeclaration(anc)) {
      // Only top-level bindings: the owning statement's parent is the file.
      const stmt = anc.getVariableStatement();
      if (stmt && Node.isSourceFile(stmt.getParent())) name = anc.getName();
    }

    if (name && localSymbolNames.has(name)) return `${relPath}#${name}`;
  }
  return undefined;
}

/**
 * Resolves a call's callee to a known `SymbolNode.id`, or `undefined` when
 * it can't be pinned to exactly one. Handles bare identifiers and
 * namespace-member accesses only; all other callee shapes are ambiguous.
 */
function resolveCallee(
  call: CallExpression,
  relPath: string,
  importMap: ImportMap,
  localSymbolNames: ReadonlySet<string>,
  knownSymbolIds: ReadonlySet<string>,
): string | undefined {
  const expr = call.getExpression();

  // Bare `foo()` — imported name first, then same-file top-level symbol.
  if (Node.isIdentifier(expr)) {
    const name = expr.getText();

    const binding = importMap.get(name);
    if (binding && binding.importedName !== "default" && binding.importedName !== "*") {
      const id = `${binding.targetPath}#${binding.importedName}`;
      if (knownSymbolIds.has(id)) return id;
      return undefined; // imported, but target isn't a known top-level symbol
    }

    if (localSymbolNames.has(name)) {
      const id = `${relPath}#${name}`;
      if (knownSymbolIds.has(id)) return id;
    }
    return undefined;
  }

  // `ns.foo()` where `ns` is a namespace import (`import * as ns`).
  if (Node.isPropertyAccessExpression(expr)) {
    const obj = expr.getExpression();
    if (Node.isIdentifier(obj)) {
      const binding = importMap.get(obj.getText());
      if (binding && binding.importedName === "*") {
        const id = `${binding.targetPath}#${expr.getName()}`;
        if (knownSymbolIds.has(id)) return id;
      }
    }
    // Any other member call (instance methods, chained calls) is ambiguous.
    return undefined;
  }

  return undefined;
}
