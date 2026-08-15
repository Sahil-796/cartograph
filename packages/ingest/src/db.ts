/**
 * The one place this package reads CognoDB. Kept behind a lazy dynamic
 * import of `@cartograph/graph` because importing that package eagerly
 * pulls in `@cartograph/config`'s env validation (COGNODB_*, REDIS_URL,
 * GROQ_API_KEY all required at import) — the pure unit tests (URL parsing,
 * guardrail decisions) inject their own `repoExists`/`nodeCountFor` and
 * must never trigger that validation just by importing this file.
 */

/** Live node count for `repoId`, or `null` if the repo isn't in the DB. */
export async function nodeCountFor(repoId: string): Promise<number | null> {
  const { countNodesPerRepo } = await import("@cartograph/graph");
  const rows = await countNodesPerRepo();
  const match = rows.find((r) => r.repoId === repoId);
  return match ? match.nodeCount : null;
}

/** Whether `repoId` already has nodes in the DB (→ serve from cache). */
export async function repoExists(repoId: string): Promise<boolean> {
  return (await nodeCountFor(repoId)) !== null;
}
