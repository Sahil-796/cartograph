import { posix } from "node:path";
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import type { EntrypointNode, HandledByEdge, SymbolNode } from "./payload.js";

/** HTTP methods we recognise on router calls and Next.js route handlers. */
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

/**
 * Extracts route/page entrypoints and the edges linking each to its
 * handler. Two conventions are recognised, both purely structural — a
 * missing entrypoint is fine, a wrong one is a bug, so nothing is inferred
 * from non-literal routes:
 *
 *  - **Next.js app router**: an `app/**​/page.*` file is a `PAGE` route;
 *    an `app/**​/route.*` file yields one entrypoint per exported HTTP-verb
 *    handler (`export function GET`/`POST`/...). Routes are derived from
 *    the file path (route groups dropped, `[param]` → `:param`,
 *    `[...rest]` → `*`).
 *  - **Express/Hono/Elysia**: `x.get("/path", handler)` style calls whose
 *    first argument is a *string literal* and which pass at least one
 *    handler argument. The literal-only + arity guard avoids mistaking
 *    e.g. `map.get("key")` for a route.
 *
 * @param symbolsInFile This file's top-level symbols, used to resolve a
 *   handler to a named `SymbolNode` (leaving `symbolId` undefined for
 *   inline/anonymous handlers).
 */
export function extractEntrypoints(
  sourceFile: SourceFile,
  repoId: string,
  relPath: string,
  symbolsInFile: readonly SymbolNode[],
): { entrypoints: EntrypointNode[]; handledBy: HandledByEdge[] } {
  const entrypoints: EntrypointNode[] = [];
  const handledBy: HandledByEdge[] = [];
  const symbolByName = new Map(symbolsInFile.map((s) => [s.name, s]));

  const add = (method: string, route: string, symbolId: string | undefined) => {
    const id = `${method} ${route}`;
    entrypoints.push({ repoId, id, kind: "route", method, route, path: relPath });
    handledBy.push({ repoId, entrypointId: id, path: relPath, ...(symbolId ? { symbolId } : {}) });
  };

  const basename = posix.basename(relPath);
  const stem = basename.replace(/\.(tsx?|jsx?)$/, "");

  if (stem === "page" && hasAppSegment(relPath)) {
    // A Next.js page: PAGE method, handler is the file's default export.
    const route = nextRoute(relPath);
    add("PAGE", route, symbolsInFile.find((s) => s.exported && isDefaultLike(s, sourceFile))?.id);
  } else if (stem === "route" && hasAppSegment(relPath)) {
    // A Next.js route handler file: one entrypoint per exported HTTP verb.
    const route = nextRoute(relPath);
    for (const sym of symbolsInFile) {
      if (!sym.exported) continue;
      const method = sym.name.toLowerCase();
      if (HTTP_METHODS.has(method)) add(sym.name.toUpperCase(), route, sym.id);
    }
  }

  // Express/Hono/Elysia router registrations, in any file.
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;

    const method = expr.getName().toLowerCase();
    if (!HTTP_METHODS.has(method)) continue;

    const args = call.getArguments();
    if (args.length < 2) continue; // need a route AND a handler — filters Map.get etc.

    const routeArg = args[0];
    if (!Node.isStringLiteral(routeArg)) continue; // literals only — no inference

    const handler = args[args.length - 1];
    const symbolId = Node.isIdentifier(handler)
      ? symbolByName.get(handler.getText())?.id
      : undefined;

    add(method.toUpperCase(), routeArg.getLiteralValue(), symbolId);
  }

  return { entrypoints, handledBy };
}

/** True if the path has an `app` directory segment (Next.js app router). */
function hasAppSegment(relPath: string): boolean {
  return relPath.split(posix.sep).includes("app");
}

/**
 * Derives a route from a Next.js app-router file path: the segments between
 * the last `app/` and the file, with route groups `(group)` dropped,
 * `[param]` rewritten to `:param`, and catch-alls `[...rest]` /
 * `[[...rest]]` rewritten to `*`. An `app/page.tsx` maps to `/`.
 */
function nextRoute(relPath: string): string {
  const segments = relPath.split(posix.sep);
  const appIdx = segments.lastIndexOf("app");
  const between = segments.slice(appIdx + 1, -1); // drop the file itself

  const parts: string[] = [];
  for (const seg of between) {
    if (seg.startsWith("(") && seg.endsWith(")")) continue; // route group: no URL segment
    if (/^\[\[?\.\.\..+\]\]?$/.test(seg)) parts.push("*"); // [...rest] / [[...rest]]
    else if (seg.startsWith("[") && seg.endsWith("]")) parts.push(`:${seg.slice(1, -1)}`);
    else parts.push(seg);
  }

  return "/" + parts.join("/");
}

/**
 * Whether a symbol is (or backs) the file's default export — the Next.js
 * page component. Covers `export default function Page` and
 * `export default Page` referring to a top-level declaration.
 */
function isDefaultLike(sym: SymbolNode, sourceFile: SourceFile): boolean {
  const decls = sourceFile.getExportedDeclarations().get("default");
  if (!decls) return false;
  return decls.some((d) => {
    const named = Node.isFunctionDeclaration(d) || Node.isClassDeclaration(d)
      ? d.getName()
      : Node.isVariableDeclaration(d)
        ? d.getName()
        : undefined;
    return named === sym.name;
  });
}
