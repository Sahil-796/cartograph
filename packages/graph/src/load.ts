import { posix as posixPath } from "node:path";
import type { Session } from "neo4j-driver";
import type { GraphPayload } from "@cartograph/extract";
import { withSession } from "./driver.js";

/**
 * Options controlling how a payload is loaded. Everything here is a
 * field the extractor's `GraphPayload` does NOT carry (see
 * `packages/extract/src/payload.ts`'s `RepoNode`) but the plan's `Repo`
 * node needs: `url`/`commitSha` are supplied by whatever called the
 * extractor (the CLI knows the clone URL and the checked-out SHA;
 * extraction itself never shells out to learn them), and `pinned` is an
 * operator decision, not a fact derivable from the repo.
 */
export interface LoadOptions {
  /** Whether this repo is exempt from `evictOldestUnpinned`. Default `false`. */
  pinned?: boolean;
  /** Clone/remote URL for the repo, if known. Not present in the payload. */
  url?: string;
  /** The commit SHA the extraction was run against, if known. */
  commitSha?: string;
  /**
   * Rows per `UNWIND $batch AS row ... MERGE` round trip. Default 1000 —
   * see the file-level comment for why this must never be "per row".
   */
  batchSize?: number;
}

/** Per-label / per-relationship-type counts the CLI prints after a load. */
export interface LoadResult {
  nodes: {
    repo: number;
    file: number;
    symbol: number;
    entrypoint: number;
    author: number;
    commit: number;
    total: number;
  };
  edges: {
    imports: number;
    defines: number;
    calls: number;
    handledBy: number;
    changed: number;
    authored: number;
    coChanged: number;
    total: number;
  };
}

/**
 * Splits `items` into chunks of at most `size`. The one thing standing
 * between "one round trip per thousand rows" and "one round trip per
 * row" — every batched `session.run` call in this file goes through
 * this helper first. `size` must be >= 1; a `size` of 0 would loop
 * forever, so we defensively floor it at 1.
 */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const safeSize = Math.max(1, size);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) {
    chunks.push(items.slice(i, i + safeSize));
  }
  return chunks;
}

/**
 * Runs `cypher` once per chunk of `rows`, always as `UNWIND $batch AS
 * row ...`. This is the single place that turns "a list of plain
 * objects" into "N round trips to CognoDB" for every node/relationship
 * type below — every call site in `loadPayload` is one line through
 * here rather than a hand-rolled loop, so the batching behaviour (and
 * the ability to assert on it in tests) lives in exactly one function.
 *
 * `repoId` is passed as a scalar query parameter (`$repoId`) rather than
 * read off each `row`, and the MERGE/MATCH patterns below key on
 * `$repoId`. This is not cosmetic: measured against CognoDB, keying an
 * `UNWIND ... MATCH (n {repoId: row.repoId, ...})` on a per-row property
 * makes its planner fall back to a full label scan *per row* (~33 ms per
 * edge — a 20k-edge repo times out on the free tier's per-request
 * deadline). Hoisting `repoId` to a constant parameter lets the planner
 * use the composite `(repoId, path)`/`(repoId, id)` indexes for the seek
 * (~1.5 ms per edge). All rows in one load share a repo, so this is
 * always safe.
 */
async function runBatched(
  session: Session,
  cypher: string,
  rows: readonly unknown[],
  batchSize: number,
  repoId: string,
): Promise<void> {
  for (const batch of chunk(rows, batchSize)) {
    if (batch.length === 0) continue;
    await session.run(cypher, { batch, repoId });
  }
}

/** Repo-relative POSIX directory of `path`, e.g. `src/foo/bar.ts` -> `src/foo`. */
function deriveDir(path: string): string {
  return posixPath.dirname(path);
}

/** Parses an ISO-8601 timestamp into epoch seconds for Cypher arithmetic. */
function toEpochSeconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

// ---------------------------------------------------------------------------
// Cypher, one MERGE statement per label/relationship type. All keyed on the
// natural identity (repoId + the field noted in the comment) rather than
// CREATEd fresh every load, so re-running the loader on an unchanged (or
// updated) payload updates properties in place instead of duplicating nodes
// — this idempotency is a graded exit test for Phase 3.
//
// `SET n += row` merges the row's properties onto the node/relationship
// without touching the identity fields used in the MERGE pattern, which is
// exactly the "identity stable, properties refresh" behaviour we want.
// ---------------------------------------------------------------------------

const REPO_MERGE = /* cypher */ `
UNWIND $batch AS row
MERGE (r:Repo {repoId: $repoId})
SET r += row
`;

const FILE_MERGE = /* cypher */ `
UNWIND $batch AS row
MERGE (f:File {repoId: $repoId, path: row.path})
SET f += row
`;

const SYMBOL_MERGE = /* cypher */ `
UNWIND $batch AS row
MERGE (s:Symbol {repoId: $repoId, id: row.id})
SET s += row
`;

const ENTRYPOINT_MERGE = /* cypher */ `
UNWIND $batch AS row
MERGE (e:Entrypoint {repoId: $repoId, id: row.id})
SET e += row
`;

const AUTHOR_MERGE = /* cypher */ `
UNWIND $batch AS row
MERGE (a:Author {repoId: $repoId, email: row.email})
SET a += row
`;

const COMMIT_MERGE = /* cypher */ `
UNWIND $batch AS row
MERGE (c:Commit {repoId: $repoId, sha: row.sha})
SET c += row
`;

const IMPORTS_MERGE = /* cypher */ `
UNWIND $batch AS row
MATCH (from:File {repoId: $repoId, path: row.fromPath})
MATCH (to:File {repoId: $repoId, path: row.toPath})
MERGE (from)-[rel:IMPORTS]->(to)
`;

const DEFINES_MERGE = /* cypher */ `
UNWIND $batch AS row
MATCH (f:File {repoId: $repoId, path: row.filePath})
MATCH (s:Symbol {repoId: $repoId, id: row.symbolId})
MERGE (f)-[rel:DEFINES]->(s)
`;

const CALLS_MERGE = /* cypher */ `
UNWIND $batch AS row
MATCH (from:Symbol {repoId: $repoId, id: row.fromSymbolId})
MATCH (to:Symbol {repoId: $repoId, id: row.toSymbolId})
MERGE (from)-[rel:CALLS]->(to)
SET rel.count = row.count
`;

const HANDLED_BY_MERGE = /* cypher */ `
UNWIND $batch AS row
MATCH (e:Entrypoint {repoId: $repoId, id: row.entrypointId})
MATCH (s:Symbol {repoId: $repoId, id: row.symbolId})
MERGE (e)-[rel:HANDLED_BY]->(s)
`;

const CHANGED_MERGE = /* cypher */ `
UNWIND $batch AS row
MATCH (c:Commit {repoId: $repoId, sha: row.sha})
MATCH (f:File {repoId: $repoId, path: row.path})
MERGE (c)-[rel:CHANGED]->(f)
SET rel.added = row.added, rel.deleted = row.deleted
`;

const AUTHORED_MERGE = /* cypher */ `
UNWIND $batch AS row
MATCH (a:Author {repoId: $repoId, email: row.authorEmail})
MATCH (c:Commit {repoId: $repoId, sha: row.sha})
MERGE (a)-[rel:AUTHORED]->(c)
`;

const CO_CHANGES_MERGE = /* cypher */ `
UNWIND $batch AS row
MATCH (a:File {repoId: $repoId, path: row.pathA})
MATCH (b:File {repoId: $repoId, path: row.pathB})
MERGE (a)-[rel:CO_CHANGES]->(b)
SET rel.count = row.count, rel.strength = row.strength
`;

/**
 * Loads a `GraphPayload` (the output of `@cartograph/extract`'s
 * `extractRepo`) into CognoDB.
 *
 * Two invariants matter more than anything else in this function:
 *
 * 1. **Batched, not per-row.** Every node/relationship type below is
 *    written via `UNWIND $batch AS row ... MERGE` in chunks of
 *    `batchSize` (default 1000) through `runBatched`/`chunk`. A repo
 *    with tens of thousands of symbols and commits would otherwise mean
 *    tens of thousands of round trips; batching makes it dozens.
 *
 * 2. **Fixed load order: Repo -> File -> Symbol -> Entrypoint -> Author
 *    -> Commit, THEN every relationship type.** Every relationship MERGE
 *    below does `MATCH` on both endpoints before merging the edge — if a
 *    relationship batch ran before its endpoint nodes existed, the
 *    `MATCH` would simply find nothing and silently drop the edge. The
 *    order here is not stylistic; it's load-bearing.
 *
 * MERGE (never CREATE) keyed on each label's natural identity means
 * calling this function twice on the same (or updated) payload does not
 * duplicate nodes or relationships — properties are refreshed via
 * `SET n += row` but identity stays put. This idempotency is required
 * behaviour, not an optimisation.
 */
export async function loadPayload(payload: GraphPayload, opts: LoadOptions = {}): Promise<LoadResult> {
  const batchSize = opts.batchSize ?? 1000;
  const pinned = opts.pinned ?? false;
  const ingestedAt = new Date().toISOString();
  const repoId = payload.repo.id;

  // --- Derivations -----------------------------------------------------

  // File.dir: POSIX dirname of File.path. A fact about the path string,
  // not an inference — computed once here rather than asking every
  // consumer query to re-derive it from `path` with string functions.
  const fileRows = payload.files.map((file) => ({
    ...file,
    dir: deriveDir(file.path),
  }));

  // Commit.fileCount: number of TouchedEdges naming that sha. Needed by
  // the (later, other-agent-owned) ownership query's `fileCount <= 30`
  // filter, so it has to be a stored property rather than computed at
  // query time.
  const touchCountBySha = new Map<string, number>();
  for (const touch of payload.touched) {
    touchCountBySha.set(touch.sha, (touchCountBySha.get(touch.sha) ?? 0) + 1);
  }
  const commitRows = payload.commits.map((commit) => ({
    ...commit,
    // Keep the original ISO string under its payload name (`timestamp`)
    // AND store the epoch-seconds form the ownership-decay query needs
    // to do `($now - c.committedAt)` arithmetic in Cypher, which cannot
    // parse ISO strings itself.
    committedAt: toEpochSeconds(commit.timestamp),
    committedAtIso: commit.timestamp,
    fileCount: touchCountBySha.get(commit.sha) ?? 0,
  }));

  // Author.firstSeen/lastSeen: optional, but trivial to derive as the
  // min/max commit timestamp per author email — no separate source of
  // truth needed beyond the commits we already have.
  const commitTimestampsByEmail = new Map<string, string[]>();
  for (const commit of payload.commits) {
    const list = commitTimestampsByEmail.get(commit.authorEmail) ?? [];
    list.push(commit.timestamp);
    commitTimestampsByEmail.set(commit.authorEmail, list);
  }
  const authorRows = payload.authors.map((author) => {
    const timestamps = commitTimestampsByEmail.get(author.email) ?? [];
    const sorted = [...timestamps].sort();
    return {
      ...author,
      ...(sorted.length > 0 ? { firstSeen: sorted[0], lastSeen: sorted[sorted.length - 1] } : {}),
    };
  });

  // Repo.nodeCount: total nodes this load contributes, including the
  // Repo node itself.
  const nodeCount =
    payload.files.length +
    payload.symbols.length +
    payload.entrypoints.length +
    payload.authors.length +
    payload.commits.length +
    1;
  const repoRow = {
    repoId,
    name: payload.repo.name,
    url: opts.url,
    commitSha: opts.commitSha,
    pinned,
    ingestedAt,
    nodeCount,
  };

  // CALLS.count: payload.calls may contain duplicate (fromSymbolId,
  // toSymbolId) pairs (e.g. a symbol calling another symbol at multiple
  // call sites); aggregate into a single edge carrying a count rather
  // than merging the same relationship repeatedly with no signal lost.
  const callCounts = new Map<string, { repoId: string; fromSymbolId: string; toSymbolId: string; count: number }>();
  for (const call of payload.calls) {
    const key = `${call.fromSymbolId} ${call.toSymbolId}`;
    const existing = callCounts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      callCounts.set(key, {
        repoId: call.repoId,
        fromSymbolId: call.fromSymbolId,
        toSymbolId: call.toSymbolId,
        count: 1,
      });
    }
  }
  const callRows = [...callCounts.values()];

  // AUTHORED: the payload has no authored-edge array (see the comment on
  // `CommitNode.authorEmail` in payload.ts) — derive it by pairing every
  // commit with the author whose email it names, joined within repoId.
  const authoredRows = payload.commits.map((commit) => ({
    repoId: commit.repoId,
    authorEmail: commit.authorEmail,
    sha: commit.sha,
  }));

  // CHANGED (Commit -> File): field names in the plan are `added`/
  // `deleted`; the payload's TouchedEdge calls them `additions`/
  // `deletions`. Rename at the boundary rather than smuggling the
  // extractor's naming into the graph schema.
  const changedRows = payload.touched.map((touch) => ({
    repoId: touch.repoId,
    sha: touch.sha,
    path: touch.path,
    added: touch.additions,
    deleted: touch.deletions,
  }));

  // HANDLED_BY: only edges with a resolved symbolId can be materialised
  // as a graph relationship — `HandledByEdge.symbolId` is optional
  // precisely because some handlers can't be tied to a named symbol
  // (see payload.ts); those edges have nothing on the Symbol side to
  // MATCH against, so they're dropped here rather than sent to CognoDB
  // to fail the MATCH silently.
  const handledByRows = payload.handledBy.filter(
    (edge): edge is typeof edge & { symbolId: string } => edge.symbolId !== undefined,
  );

  const result = await withSession(async (session) => {
    // --- Fixed node load order --------------------------------------
    await runBatched(session, REPO_MERGE, [repoRow], batchSize, repoId);
    await runBatched(session, FILE_MERGE, fileRows, batchSize, repoId);
    await runBatched(session, SYMBOL_MERGE, payload.symbols, batchSize, repoId);
    await runBatched(session, ENTRYPOINT_MERGE, payload.entrypoints, batchSize, repoId);
    await runBatched(session, AUTHOR_MERGE, authorRows, batchSize, repoId);
    await runBatched(session, COMMIT_MERGE, commitRows, batchSize, repoId);

    // --- Relationships, only after every endpoint label is loaded ---
    await runBatched(session, IMPORTS_MERGE, payload.imports, batchSize, repoId);
    await runBatched(session, DEFINES_MERGE, payload.defines, batchSize, repoId);
    await runBatched(session, CALLS_MERGE, callRows, batchSize, repoId);
    await runBatched(session, HANDLED_BY_MERGE, handledByRows, batchSize, repoId);
    await runBatched(session, CHANGED_MERGE, changedRows, batchSize, repoId);
    await runBatched(session, AUTHORED_MERGE, authoredRows, batchSize, repoId);
    await runBatched(session, CO_CHANGES_MERGE, payload.coChanged, batchSize, repoId);

    const loadResult: LoadResult = {
      nodes: {
        repo: 1,
        file: fileRows.length,
        symbol: payload.symbols.length,
        entrypoint: payload.entrypoints.length,
        author: authorRows.length,
        commit: commitRows.length,
        total: nodeCount,
      },
      edges: {
        imports: payload.imports.length,
        defines: payload.defines.length,
        calls: callRows.length,
        handledBy: handledByRows.length,
        changed: changedRows.length,
        authored: authoredRows.length,
        coChanged: payload.coChanged.length,
        total:
          payload.imports.length +
          payload.defines.length +
          callRows.length +
          handledByRows.length +
          changedRows.length +
          authoredRows.length +
          payload.coChanged.length,
      },
    };
    return loadResult;
  });

  return result;
}
