import { Node, SyntaxKind, type CallExpression, type ClassDeclaration, type SourceFile } from "ts-morph";
import type { CallsEdge } from "./payload.js";
import type { ImportMap } from "./imports.js";
import { scopeChain, qualify, qualifiedId } from "./scope.js";

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
 * @param localSymbolIds Every `SymbolNode.id` DEFINED in this file — used to
 *   attribute a call to its nearest enclosing recorded symbol and to resolve
 *   bare calls to a lexically-visible nested function.
 * @param knownSymbolIds Every `SymbolNode.id` in the repo, for membership
 *   testing so we only emit edges pointing at a symbol that truly exists.
 */
export function extractCalls(
  sourceFile: SourceFile,
  repoId: string,
  relPath: string,
  importMap: ImportMap,
  localSymbolIds: ReadonlySet<string>,
  knownSymbolIds: ReadonlySet<string>,
): CallExtraction {
  const calls: CallsEdge[] = [];
  let callsObserved = 0;
  let callsInScope = 0;

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    callsObserved++;

    // Callee first: does this call even point at something in the model?
    // If not (external package, unknown global, cross-instance method), it is
    // out of scope and never enters the resolution-rate denominator.
    const toSymbolId = resolveCallee(call, relPath, importMap, localSymbolIds, knownSymbolIds);
    if (!toSymbolId) continue;
    callsInScope++;

    // In-scope target, but the caller may be a module-top-level call with no
    // enclosing recorded symbol to attribute the edge to. That counts against
    // the rate (in scope, unresolved) rather than being skipped.
    const fromSymbolId = findEnclosingSymbolId(call, relPath, localSymbolIds);
    if (!fromSymbolId) continue;

    calls.push({ repoId, fromSymbolId, toSymbolId });
  }

  return { calls, callsResolved: calls.length, callsInScope, callsObserved };
}

/**
 * Walks up from a call to the nearest enclosing declaration that corresponds
 * to a RECORDED symbol, returning its qualified `${relPath}#${qualified}` id.
 *
 * Because the symbol extractor now records nested functions and methods, a
 * call inside `runClaimedStep` is attributed to `createWorker.runClaimedStep`,
 * and a call inside a method to `Class.method` — the nearest addressable owner,
 * not the outermost one. Returns `undefined` for calls at module top level
 * (no enclosing symbol) or inside an unrecorded scope (e.g. a local arrow
 * callback we don't index).
 */
function findEnclosingSymbolId(
  call: CallExpression,
  relPath: string,
  localSymbolIds: ReadonlySet<string>,
): string | undefined {
  for (const anc of call.getAncestors()) {
    let name: string | undefined;
    if (Node.isFunctionDeclaration(anc) || Node.isClassDeclaration(anc) || Node.isMethodDeclaration(anc)) {
      name = anc.getName();
    } else if (Node.isPropertyDeclaration(anc)) {
      const init = anc.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) name = anc.getName();
    } else if (Node.isVariableDeclaration(anc)) {
      // A callable binding: `const double = () => { add(n, n) }`. Recorded as a
      // top-level `arrow`/`const` symbol, so a call inside it must be attributed
      // to that binding. Nested local bindings aren't recorded, so the
      // `localSymbolIds` membership test below correctly rejects them.
      const init = anc.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) name = anc.getName();
    }
    if (!name) continue;

    const id = `${relPath}#${qualify(scopeChain(anc), name)}`;
    if (localSymbolIds.has(id)) return id;
  }
  return undefined;
}

/**
 * Resolves a call's callee to a known `SymbolNode.id`, or `undefined` when it
 * can't be pinned to exactly one. Handles three unambiguous shapes:
 *   - bare `foo()` imported from another file (`import { foo }`);
 *   - bare `foo()` resolving to a lexically-visible symbol in this file,
 *     preferring the nearest enclosing scope (so a nested `runClaimedStep`
 *     shadows a hypothetical top-level one);
 *   - `this.foo()` resolving to a method of the enclosing class.
 * plus namespace-member `ns.foo()`. All other member calls (`obj.foo()` on an
 * arbitrary instance, chained calls) stay ambiguous and are never guessed.
 */
function resolveCallee(
  call: CallExpression,
  relPath: string,
  importMap: ImportMap,
  localSymbolIds: ReadonlySet<string>,
  knownSymbolIds: ReadonlySet<string>,
): string | undefined {
  const expr = call.getExpression();

  // Bare `foo()` — imported name first, then a lexically-visible local symbol.
  if (Node.isIdentifier(expr)) {
    const name = expr.getText();

    const binding = importMap.get(name);
    if (binding && binding.importedName !== "default" && binding.importedName !== "*") {
      const id = `${binding.targetPath}#${binding.importedName}`;
      if (knownSymbolIds.has(id)) return id;
      return undefined; // imported, but target isn't a known symbol
    }

    // Lexical resolution: try the call's own scope first, then each enclosing
    // scope outward, so `runClaimedStep()` inside `createWorker` resolves to
    // `createWorker.runClaimedStep` before any top-level `runClaimedStep`.
    for (const prefix of enclosingScopePrefixes(call)) {
      const id = qualifiedId(relPath, prefix, name);
      if (localSymbolIds.has(id)) return id;
    }
    return undefined;
  }

  if (Node.isPropertyAccessExpression(expr)) {
    const obj = expr.getExpression();

    // `this.foo()` — unambiguous within a class: `this` is the enclosing class
    // instance, so the callee is that class's `foo` method (or arrow property).
    if (obj.getKind() === SyntaxKind.ThisKeyword) {
      const cls = findEnclosingClass(call);
      if (cls) {
        const clsName = cls.getName();
        if (clsName) {
          const id = `${relPath}#${qualify(scopeChain(cls), clsName)}.${expr.getName()}`;
          if (localSymbolIds.has(id)) return id;
        }
      }
      return undefined;
    }

    // `ns.foo()` where `ns` is a namespace import (`import * as ns`).
    if (Node.isIdentifier(obj)) {
      const binding = importMap.get(obj.getText());
      if (binding && binding.importedName === "*") {
        const id = `${binding.targetPath}#${expr.getName()}`;
        if (knownSymbolIds.has(id)) return id;
      }
    }
    // Any other member call (arbitrary instance methods, chained calls) is
    // ambiguous at this granularity and never guessed.
    return undefined;
  }

  return undefined;
}

/**
 * The scope-chain prefixes visible from `call`, innermost first, ending with
 * `""` (module top). e.g. a call inside function `createWorker` yields
 * `["createWorker", ""]`; a call inside method `run` of class `Worker` yields
 * `["Worker.run", "Worker", ""]`. Used to resolve a bare identifier to the
 * nearest lexically-enclosing declaration of that name.
 */
function enclosingScopePrefixes(call: CallExpression): string[] {
  const prefixes: string[] = [];
  const seen = new Set<string>();
  for (const anc of call.getAncestors()) {
    let name: string | undefined;
    if (Node.isFunctionDeclaration(anc) || Node.isClassDeclaration(anc) || Node.isMethodDeclaration(anc)) {
      name = anc.getName();
    } else if (Node.isPropertyDeclaration(anc)) {
      name = anc.getName();
    } else if (Node.isVariableDeclaration(anc)) {
      const init = anc.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) name = anc.getName();
    }
    if (!name) continue;
    const chain = qualify(scopeChain(anc), name);
    if (!seen.has(chain)) {
      seen.add(chain);
      prefixes.push(chain);
    }
  }
  prefixes.push(""); // module top level
  return prefixes;
}

/** The nearest `class` ancestor of a node, or `undefined`. */
function findEnclosingClass(node: CallExpression): ClassDeclaration | undefined {
  for (const anc of node.getAncestors()) {
    if (Node.isClassDeclaration(anc)) return anc;
  }
  return undefined;
}
