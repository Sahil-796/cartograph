/**
 * The clone step, isolated so the pipeline can inject a fake for tests and
 * so the git incantation lives in exactly one place.
 *
 * We clone shallow and blobless: `--depth 500` keeps enough history for the
 * churn/co-change extraction (the guardrail table caps history at 500
 * commits) without dragging the entire past; `--filter=blob:none` fetches
 * file contents lazily so the initial transfer is metadata + tree only,
 * then blobs are backfilled on checkout. `--single-branch` avoids pulling
 * every branch's tip.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** History depth for the shallow clone — matches the guardrail table. */
export const CLONE_DEPTH = 500;

/** Creates a fresh, unique temp directory to clone into. */
export async function makeCloneDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cartograph-ingest-"));
}

/**
 * Clones `cloneUrl` into `destDir` (which must already exist and be empty).
 * Rejects with a plain `Error` if git fails — a clone failure is unexpected
 * (the repo was proven to exist and be in-budget by precheck), not a
 * user-facing guardrail.
 */
export async function cloneRepo(cloneUrl: string, destDir: string): Promise<void> {
  await execFileAsync(
    "git",
    [
      "clone",
      "--filter=blob:none",
      "--depth",
      String(CLONE_DEPTH),
      "--single-branch",
      cloneUrl,
      destDir,
    ],
    {
      // A blobless shallow clone of a <50 MB repo is small, but give git
      // room so a slow network doesn't kill an otherwise-fine ingest.
      timeout: 5 * 60_000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
}

/** Best-effort recursive removal of a temp clone dir; never throws. */
export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {
    /* the temp dir is under the OS tmp root; a leaked dir is harmless. */
  });
}
