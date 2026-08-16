/**
 * Map-addressable node extraction.
 *
 * Given a query name and the rows `executeQuery` returned for it, produce
 * the `CitationNode[]` the frontend highlights on the map when a citation
 * chip is clicked. This is deliberately a single pure function keyed by
 * query name (the caller always knows which tool produced the rows) so the
 * per-query row shapes — documented in `packages/graph/src/queries/*.ts` —
 * map to the right node kind:
 *
 *   - file   → a file `path`
 *   - author → an author `name`
 *   - symbol → `"path#name"` (a symbol qualified by the file it lives in)
 *
 * It is intentionally defensive: an unknown query name, a missing field, or
 * a malformed row yields no node rather than throwing. Results are deduped
 * by `kind` + `ref`, preserving first-seen order.
 */
import type { CitationNode } from './chat.types';

type Row = Record<string, unknown>;

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

const fileNode = (path: unknown): CitationNode | undefined => {
  const p = asString(path);
  return p ? { kind: 'file', ref: p } : undefined;
};

const authorNode = (name: unknown): CitationNode | undefined => {
  const n = asString(name);
  return n ? { kind: 'author', ref: n } : undefined;
};

const symbolNode = (path: unknown, name: unknown): CitationNode | undefined => {
  const p = asString(path);
  const n = asString(name);
  return p && n ? { kind: 'symbol', ref: `${p}#${n}` } : undefined;
};

/**
 * Per-query row → nodes. Each entry pushes zero or more nodes for a single
 * row via `push` (which drops `undefined` for us). Anything not listed here
 * falls through to `[]`.
 */
const perRow: Record<string, (row: Row, push: (n: CitationNode | undefined) => void) => void> = {
  search: (row, push) => {
    // Discriminated by `type`: symbols carry path+name; files carry a path;
    // entrypoints are route paths (not map file nodes) so they're skipped.
    if (row.type === 'symbol') {
      push(symbolNode(row.path, row.name));
      // A symbol's map anchor is the FILE it lives in — emit that too so the
      // citation rings a node that actually exists on the file graph (the raw
      // "path#name" symbol id only resolves when that file's symbol overlay is
      // rendered, which it usually isn't).
      push(fileNode(row.path));
    } else if (row.type === 'file') push(fileNode(row.path));
  },
  // neighbors + path both walk the CALLS graph over Symbol nodes.
  neighbors: (row, push) => push(symbolNode(row.path, row.name)),
  path: (row, push) => push(symbolNode(row.path, row.name)),
  who_touched: (row, push) => push(authorNode(row.name)),
  bus_factor: (row, push) => {
    // A single row whose `contributors` is the author list.
    const contributors = Array.isArray(row.contributors) ? row.contributors : [];
    for (const c of contributors) {
      if (c && typeof c === 'object') push(authorNode((c as Row).name));
    }
  },
  co_changed: (row, push) => push(fileNode(row.path)),
  hidden_coupling: (row, push) => {
    push(fileNode(row.a));
    push(fileNode(row.b));
  },
  cycles: (row, push) => {
    const cycle = Array.isArray(row.cycle) ? row.cycle : [];
    for (const p of cycle) push(fileNode(p));
  },
  // entrypoints: `path` is a route, `handler` a bare symbol name with no
  // owning file — neither is a clean map node, so emit nothing.
  entrypoints: () => {},
  file_graph: (row, push) => {
    // Union of node rows (path) and edge rows (fromPath/toPath).
    if (row.kind === 'edge') {
      push(fileNode(row.fromPath));
      push(fileNode(row.toPath));
    } else {
      push(fileNode(row.path));
    }
  },
  file_metrics: (row, push) => {
    push(fileNode(row.path));
    push(authorNode(row.ownerName));
  },
  file_commits: (row, push) => push(authorNode(row.authorName)),
  tests_for_file: (row, push) => push(fileNode(row.path)),
};

/** Extract deduped, map-addressable nodes from a query's result rows. */
export function extractNodes(queryName: string, rows: unknown): CitationNode[] {
  const handler = perRow[queryName];
  if (!handler || !Array.isArray(rows)) return [];

  const out: CitationNode[] = [];
  const seen = new Set<string>();
  const push = (n: CitationNode | undefined): void => {
    if (!n) return;
    const key = `${n.kind}:${n.ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(n);
  };

  for (const row of rows) {
    if (row && typeof row === 'object') handler(row as Row, push);
  }
  return out;
}
