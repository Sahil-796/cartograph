import neo4j, { type Session } from "neo4j-driver";
import { withSession } from "./driver.js";

/** One row of `countNodesPerRepo`'s result: a `Repo` plus its live node count. */
export interface RepoNodeCount {
  repoId: string;
  pinned: boolean;
  /** ISO-8601 string, as stored on `Repo.ingestedAt`. */
  ingestedAt: string;
  /** Live count of every node carrying this `repoId` — includes the `Repo` node itself. */
  nodeCount: number;
}

export interface EvictOptions {
  /** Total node budget across all repos in the DB. Required — there is no sane default. */
  budget: number;
  /** Rows per batched `DETACH DELETE`. Default 1000, same rationale as `load.ts`. */
  batchSize?: number;
}

export interface EvictResult {
  /** `repoId`s deleted, oldest-first, in the order they were evicted. */
  evictedRepoIds: string[];
  /** Total nodes removed across all evicted repos. */
  nodesDeleted: number;
  /** Total node count across all repos before eviction ran. */
  totalNodesBefore: number;
  /** Total node count across all repos after eviction ran. */
  totalNodesAfter: number;
}

/**
 * Converts a driver-returned count into a plain JS number. `count(n)` and
 * similar aggregations come back as neo4j-driver's `Integer` type (safe
 * for values beyond 2^53), which carries a `.toNumber()` method rather
 * than being a primitive `number`. Node/repo counts in this product are
 * nowhere near that range, so converting down to a plain number is safe
 * and much easier for callers (and JSON responses) to work with.
 */
function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (
    value !== null &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof (value as { toNumber: unknown }).toNumber === "function"
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

/**
 * One row per `Repo`, its pin state, ingestion time, and its LIVE node
 * count (every node in the DB carrying that `repoId`, not the `Repo.
 * nodeCount` property recorded at load time — that property can go
 * stale if a previous eviction was interrupted, so eviction decisions
 * are always made from a fresh `count(n)`).
 */
const COUNT_QUERY = /* cypher */ `
MATCH (r:Repo)
OPTIONAL MATCH (n {repoId: r.repoId})
RETURN r.repoId AS repoId, r.pinned AS pinned, r.ingestedAt AS ingestedAt, count(n) AS nodeCount
`;

async function queryCounts(session: Session): Promise<RepoNodeCount[]> {
  const res = await session.run(COUNT_QUERY);
  return res.records.map((record) => ({
    repoId: record.get("repoId") as string,
    pinned: Boolean(record.get("pinned")),
    ingestedAt: record.get("ingestedAt") as string,
    nodeCount: toNumber(record.get("nodeCount")),
  }));
}

/** Live node count per repo, for operators/CLI to inspect budget headroom. */
export async function countNodesPerRepo(): Promise<RepoNodeCount[]> {
  return withSession((session) => queryCounts(session));
}

/**
 * Deletes up to `batchSize` nodes carrying `repoId` per round trip,
 * looping until none remain. A single unbounded `DETACH DELETE` over a
 * repo with tens of thousands of nodes risks a long-running transaction
 * that blocks other writers or spikes memory; batching keeps each
 * transaction small and bounded, matching the load side's batching
 * discipline.
 */
const DELETE_BATCH_CYPHER = /* cypher */ `
MATCH (n {repoId: $repoId})
WITH n LIMIT $batchSize
DETACH DELETE n
RETURN count(n) AS deletedCount
`;

async function deleteRepoInBatches(session: Session, repoId: string, batchSize: number): Promise<number> {
  let totalDeleted = 0;
  for (;;) {
    const res = await session.run(DELETE_BATCH_CYPHER, { repoId, batchSize: neo4j.int(batchSize) });
    const deleted = toNumber(res.records[0]?.get("deletedCount") ?? 0);
    totalDeleted += deleted;
    if (deleted === 0) break;
  }
  return totalDeleted;
}

/**
 * Enforces a total-node budget across every repo loaded into CognoDB.
 * When the sum of live node counts exceeds `opts.budget`, deletes the
 * OLDEST `pinned = false` repo (by `Repo.ingestedAt`) in full, batched
 * via `deleteRepoInBatches`, then re-checks the running total — repeating
 * until either the budget is satisfied or there are no more unpinned
 * repos left to evict (pinned repos are never touched, even over budget).
 *
 * This is an operator-triggered maintenance action against the live,
 * shared DB — never call it from a unit test against anything but a
 * mocked session.
 */
export async function evictOldestUnpinned(opts: EvictOptions): Promise<EvictResult> {
  const batchSize = opts.batchSize ?? 1000;

  return withSession(async (session) => {
    const counts = await queryCounts(session);
    const totalNodesBefore = counts.reduce((sum, c) => sum + c.nodeCount, 0);

    // Oldest-first among unpinned repos only; pinned repos are never
    // eviction candidates regardless of age or budget pressure.
    const candidates = [...counts]
      .filter((c) => !c.pinned)
      .sort((a, b) => a.ingestedAt.localeCompare(b.ingestedAt));

    let total = totalNodesBefore;
    const evictedRepoIds: string[] = [];
    let nodesDeleted = 0;

    for (const candidate of candidates) {
      if (total <= opts.budget) break;
      const deleted = await deleteRepoInBatches(session, candidate.repoId, batchSize);
      evictedRepoIds.push(candidate.repoId);
      nodesDeleted += deleted;
      total -= deleted;
    }

    return {
      evictedRepoIds,
      nodesDeleted,
      totalNodesBefore,
      totalNodesAfter: total,
    };
  });
}
