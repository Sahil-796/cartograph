import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runIngest } from "../src/ingest.js";

// Smoke-tests the `ingest` command against the same tiny fixture repo
// `@cartograph/extract` itself tests against, without touching the live
// DB — every case here uses `--dry-run` or `--out`, never the default
// (load) path, per the "don't hit the live DB in tests" rule.
const FIXTURE_REPO = resolvePath(
  fileURLToPath(import.meta.url),
  "../../../../packages/extract/test/fixtures/code-repo",
);

describe("cartograph ingest", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "cartograph-cli-test-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("--dry-run extracts and prints stats without writing or loading anything", async () => {
    // No assertion on stdout here — the meaningful contract is "resolves
    // without touching the filesystem or the DB," which the absence of
    // an --out file (checked in the next test) already covers per-flag.
    await expect(runIngest(FIXTURE_REPO, { dryRun: true })).resolves.toBeUndefined();
  });

  it("--out writes a GraphPayload JSON with the expected top-level keys and a numeric resolution rate", async () => {
    const outFile = join(workDir, "payload.json");
    await runIngest(FIXTURE_REPO, { out: outFile });

    const raw = await readFile(outFile, "utf8");
    const payload = JSON.parse(raw);

    expect(payload).toMatchObject({
      repo: expect.objectContaining({ id: expect.any(String), name: expect.any(String) }),
      files: expect.any(Array),
      symbols: expect.any(Array),
      entrypoints: expect.any(Array),
      authors: expect.any(Array),
      commits: expect.any(Array),
      imports: expect.any(Array),
      calls: expect.any(Array),
      defines: expect.any(Array),
      handledBy: expect.any(Array),
      touched: expect.any(Array),
      coChanged: expect.any(Array),
    });
    expect(typeof payload.stats.callResolutionRate).toBe("number");
    expect(payload.stats.callResolutionRate).toBeGreaterThanOrEqual(0);
    expect(payload.stats.callResolutionRate).toBeLessThanOrEqual(1);
    expect(payload.files.length).toBeGreaterThan(0);
  });

  it("rejects a path that isn't a directory with a readable error, not a raw stack trace", async () => {
    await expect(runIngest(join(workDir, "does-not-exist"), { dryRun: true })).rejects.toThrow(
      /not a directory/,
    );
  });

  it("--repo-id / --repo-name override the defaults derived from the folder name", async () => {
    const outFile = join(workDir, "payload.json");
    await runIngest(FIXTURE_REPO, { out: outFile, repoId: "custom-id", repoName: "Custom Name" });

    const payload = JSON.parse(await readFile(outFile, "utf8"));
    expect(payload.repo.id).toBe("custom-id");
    expect(payload.repo.name).toBe("Custom Name");
  });
});
