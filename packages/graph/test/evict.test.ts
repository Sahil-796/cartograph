import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fake neo4j Integer: `count()`/aggregations return a driver `Integer`
 * object with `.toNumber()` rather than a primitive `number`. Mirroring
 * that here exercises `evict.ts`'s `toNumber` conversion the same way a
 * real driver response would.
 */
function fakeInt(n: number) {
  return { toNumber: () => n };
}

function record(fields: Record<string, unknown>) {
  return { get: (key: string) => fields[key] };
}

const runMock = vi.fn();
const fakeSession = { run: runMock };

vi.mock("../src/driver.js", () => ({
  withSession: async (fn: (session: typeof fakeSession) => Promise<unknown>) => fn(fakeSession),
}));

const { evictOldestUnpinned, countNodesPerRepo } = await import("../src/evict.js");

beforeEach(() => {
  runMock.mockReset();
});

describe("countNodesPerRepo", () => {
  it("maps count/pinned/ingestedAt rows, converting driver Integers to numbers", async () => {
    runMock.mockResolvedValueOnce({
      records: [
        record({ repoId: "repo-a", pinned: true, ingestedAt: "2024-01-01T00:00:00Z", nodeCount: fakeInt(42) }),
        record({ repoId: "repo-b", pinned: false, ingestedAt: "2024-02-01T00:00:00Z", nodeCount: fakeInt(10) }),
      ],
    });

    const counts = await countNodesPerRepo();

    expect(counts).toEqual([
      { repoId: "repo-a", pinned: true, ingestedAt: "2024-01-01T00:00:00Z", nodeCount: 42 },
      { repoId: "repo-b", pinned: false, ingestedAt: "2024-02-01T00:00:00Z", nodeCount: 10 },
    ]);
  });
});

describe("evictOldestUnpinned — under budget", () => {
  it("deletes nothing when the total node count is within budget", async () => {
    runMock.mockResolvedValueOnce({
      records: [
        record({ repoId: "repo-a", pinned: false, ingestedAt: "2024-01-01T00:00:00Z", nodeCount: fakeInt(50) }),
      ],
    });

    const result = await evictOldestUnpinned({ budget: 100 });

    expect(result.evictedRepoIds).toEqual([]);
    expect(result.nodesDeleted).toBe(0);
    expect(result.totalNodesBefore).toBe(50);
    expect(result.totalNodesAfter).toBe(50);
    // Only the count query ran — no DETACH DELETE was issued.
    expect(runMock).toHaveBeenCalledTimes(1);
    for (const call of runMock.mock.calls) {
      expect(call[0] as string).not.toMatch(/DETACH DELETE/);
    }
  });
});

describe("evictOldestUnpinned — over budget", () => {
  it("evicts the oldest unpinned repo via a batched DETACH DELETE loop", async () => {
    runMock.mockResolvedValueOnce({
      records: [
        // Newer, should survive.
        record({ repoId: "repo-new", pinned: false, ingestedAt: "2024-06-01T00:00:00Z", nodeCount: fakeInt(60) }),
        // Oldest unpinned — should be evicted first.
        record({ repoId: "repo-old", pinned: false, ingestedAt: "2024-01-01T00:00:00Z", nodeCount: fakeInt(50) }),
      ],
    });
    // Batched delete loop for repo-old: two batches of work then a 0 to stop.
    runMock.mockResolvedValueOnce({ records: [record({ deletedCount: fakeInt(30) })] });
    runMock.mockResolvedValueOnce({ records: [record({ deletedCount: fakeInt(20) })] });
    runMock.mockResolvedValueOnce({ records: [record({ deletedCount: fakeInt(0) })] });

    const result = await evictOldestUnpinned({ budget: 90, batchSize: 30 });

    expect(result.evictedRepoIds).toEqual(["repo-old"]);
    expect(result.nodesDeleted).toBe(50);
    expect(result.totalNodesBefore).toBe(110);
    expect(result.totalNodesAfter).toBe(60);

    const deleteCalls = runMock.mock.calls.filter((call) => (call[0] as string).includes("DETACH DELETE"));
    expect(deleteCalls).toHaveLength(3);
    for (const call of deleteCalls) {
      expect((call[1] as { repoId: string }).repoId).toBe("repo-old");
    }
  });

  it("never evicts a pinned repo even when over budget", async () => {
    runMock.mockResolvedValueOnce({
      records: [record({ repoId: "repo-pinned", pinned: true, ingestedAt: "2020-01-01T00:00:00Z", nodeCount: fakeInt(500) })],
    });

    const result = await evictOldestUnpinned({ budget: 10 });

    expect(result.evictedRepoIds).toEqual([]);
    expect(result.nodesDeleted).toBe(0);
    expect(result.totalNodesAfter).toBe(500);
    const deleteCalls = runMock.mock.calls.filter((call) => (call[0] as string).includes("DETACH DELETE"));
    expect(deleteCalls).toHaveLength(0);
  });

  it("evicts multiple oldest-unpinned repos in order until under budget", async () => {
    runMock.mockResolvedValueOnce({
      records: [
        record({ repoId: "repo-c", pinned: false, ingestedAt: "2024-03-01T00:00:00Z", nodeCount: fakeInt(20) }),
        record({ repoId: "repo-a", pinned: false, ingestedAt: "2024-01-01T00:00:00Z", nodeCount: fakeInt(20) }),
        record({ repoId: "repo-b", pinned: false, ingestedAt: "2024-02-01T00:00:00Z", nodeCount: fakeInt(20) }),
      ],
    });
    // repo-a deletion (oldest first)
    runMock.mockResolvedValueOnce({ records: [record({ deletedCount: fakeInt(20) })] });
    runMock.mockResolvedValueOnce({ records: [record({ deletedCount: fakeInt(0) })] });
    // repo-b deletion (next oldest)
    runMock.mockResolvedValueOnce({ records: [record({ deletedCount: fakeInt(20) })] });
    runMock.mockResolvedValueOnce({ records: [record({ deletedCount: fakeInt(0) })] });

    const result = await evictOldestUnpinned({ budget: 30, batchSize: 20 });

    expect(result.evictedRepoIds).toEqual(["repo-a", "repo-b"]);
    expect(result.nodesDeleted).toBe(40);
    expect(result.totalNodesAfter).toBe(20);
  });
});
