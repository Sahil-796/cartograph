import "./load-env.js";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { closeDriver, verifyConnectivityAndLog } from "../driver.js";
import { initSchema } from "../schema.js";
import { loadPayload } from "../load.js";
import type { GraphPayload } from "@cartograph/extract";

/**
 * Loads every committed `seed/*.json` payload into CognoDB as a **pinned**
 * repo — the deploy-time counterpart to the CLI's `ingest`.
 *
 * The seed payloads are produced once by `cartograph ingest <repo> --out
 * seed/<id>.json` and committed so a reviewer can populate a fresh database
 * without cloning (or even having network access to) the original repos.
 * This script is the "loaded at deploy" half of that story: it reads each
 * payload back and runs the identical `loadPayload` the live ingest worker
 * uses, so the seed proves the real pipeline rather than a bespoke import
 * path.
 *
 * Pinned, because these are the demo repos: the eviction policy
 * (`evict.ts`) only ever removes `pinned = false` repos, so the seed set
 * survives while user ingests roll over. Idempotent, because `loadPayload`
 * MERGEs on stable keys — re-running never duplicates nodes.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.resolve(here, "../../../../seed");

async function main(): Promise<void> {
  console.log("Connecting to CognoDB...");
  await verifyConnectivityAndLog();

  // Ensure indexes exist before a bulk load — matching MERGEs on unindexed
  // properties would otherwise scan every node.
  await initSchema();

  const entries = (await readdir(seedDir)).filter((f) => f.endsWith(".json"));
  if (entries.length === 0) {
    console.log(`No seed payloads found in ${seedDir}.`);
    return;
  }

  // Read every payload up front so we can load smallest-first — a quick,
  // cheap way to prove connectivity/schema against the small repos before
  // committing minutes to the large ones.
  const payloads = await Promise.all(
    entries.map(async (file) => {
      const raw = await readFile(path.join(seedDir, file), "utf8");
      return { file, payload: JSON.parse(raw) as GraphPayload };
    }),
  );
  payloads.sort((a, b) => a.payload.files.length - b.payload.files.length);

  // Chunk size is deliberately small: CognoDB's free (c0) tier enforces a
  // short per-transaction deadline, and each row in the relationship
  // batches does two indexed MATCHes plus a MERGE. 1,000-row transactions
  // trip "context deadline exceeded" on the larger repos; ~400 stays well
  // inside the limit while still being one round trip per 400 rows.
  // Overridable via SEED_BATCH_SIZE for a beefier instance.
  const batchSize = Number(process.env.SEED_BATCH_SIZE ?? 300);

  for (const { file, payload } of payloads) {
    process.stdout.write(`Loading ${file} (repo "${payload.repo.id}")... `);
    const result = await loadPayload(payload, { pinned: true, batchSize });
    console.log(`${result.nodes.total} nodes, ${result.edges.total} edges`);
  }

  console.log(`✓ ${entries.length} seed repo(s) loaded and pinned`);
}

main()
  .then(async () => {
    await closeDriver();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error("db:seed failed:", error instanceof Error ? error.message : error);
    await closeDriver();
    process.exit(1);
  });
