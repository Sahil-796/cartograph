/**
 * The `ingest` command's implementation, split out of `index.ts` so the
 * arg-parsing wiring and the actual pipeline stay independently readable
 * (and so the smoke test can call this directly without going through
 * `commander`/`process.argv`).
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import { extractRepo, type GraphPayload, type ExtractionStats } from "@cartograph/extract";
// `@cartograph/graph` is imported dynamically inside the load branch below
// rather than at module top-level: importing it eagerly pulls in
// `@cartograph/config`'s env validation (COGNODB_*, REDIS_URL, GROQ_API_KEY
// all required), which would make `--dry-run` and `--out` — paths that
// touch no database — fail on missing DB env vars they have no business
// needing. Type-only import below is erased at compile time, so it costs
// nothing at runtime.
import type { LoadResult } from "@cartograph/graph";

/** Raw options as parsed by commander (kebab-case flags become camelCase). */
export interface IngestCliOptions {
  out?: string;
  repoId?: string;
  repoName?: string;
  pin?: boolean;
  dryRun?: boolean;
  history?: boolean;
  url?: string;
  commits?: string;
}

/**
 * Contract for the three ways this command can end, chosen for the
 * simplest mental model rather than maximal flexibility:
 *
 *   --dry-run   -> extract only. No JSON written, nothing loaded.
 *   --out <f>   -> extract + write JSON to <f>. Nothing loaded. This is
 *                  the seed-generation path: `--out` alone answers "give
 *                  me the payload", not "and also mutate the shared DB".
 *   (neither)   -> extract + load into CognoDB. The default, because the
 *                  command is named `ingest`, not `extract`.
 *
 * `--dry-run` and `--out` are not combined (dry-run wins) — dry-run means
 * "don't produce any artifact," full stop.
 */
export async function runIngest(repoPathArg: string, opts: IngestCliOptions): Promise<void> {
  const repoPath = resolvePath(repoPathArg);

  // Fail fast with a readable message rather than letting ts-morph/git
  // produce a confusing error deep in the extractor for a typo'd path.
  const targetStat = await stat(repoPath).catch(() => null);
  if (!targetStat || !targetStat.isDirectory()) {
    throw new Error(`not a directory: ${repoPath}`);
  }

  // `--commits` is in the plan's flag list but extraction has no lever
  // for history depth — that's a clone-time concern (`git clone --depth`),
  // not something a local extractor can retroactively enforce on a
  // checkout that already has whatever depth is on disk. Accept the flag
  // rather than erroring (so scripts written against the plan don't
  // break), but say plainly that it did nothing.
  if (opts.commits !== undefined) {
    console.error(
      `note: --commits ${opts.commits} is a no-op for a local checkout — history depth is fixed by how the repo was cloned, not by this command`,
    );
  }

  const payload = await extractRepo(repoPath, {
    repoId: opts.repoId,
    repoName: opts.repoName,
    history: opts.history,
  });

  if (opts.dryRun) {
    printStatsSummary(payload);
    return;
  }

  if (opts.out) {
    await mkdir(dirname(resolvePath(opts.out)), { recursive: true });
    await writeFile(resolvePath(opts.out), JSON.stringify(payload, null, 2) + "\n", "utf8");
    printStatsSummary(payload);
    console.log(`wrote payload to ${resolvePath(opts.out)}`);
    return;
  }

  const { loadPayload } = await import("@cartograph/graph");
  const result = await loadPayload(payload, {
    pinned: opts.pin ?? false,
    url: opts.url,
  });
  printStatsSummary(payload);
  printLoadResult(result);
}

/** `call resolution: 87% (45/52 in-scope; 377 observed)` — the honesty metric, always printed. */
function formatCallResolution(stats: ExtractionStats): string {
  const pct = Math.round(stats.callResolutionRate * 100);
  return `call resolution: ${pct}% (${stats.callsResolved}/${stats.callsInScope} in-scope; ${stats.callsObserved} observed)`;
}

function printStatsSummary(payload: GraphPayload): void {
  console.log(`repo: ${payload.repo.name} (${payload.repo.id})`);
  console.log(`files: ${payload.files.length}`);
  console.log(`symbols: ${payload.symbols.length}`);
  console.log(`commits: ${payload.commits.length}`);
  console.log(formatCallResolution(payload.stats));
}

function printLoadResult(result: LoadResult): void {
  console.log(
    `loaded: ${result.nodes.total} nodes (repo ${result.nodes.repo}, file ${result.nodes.file}, symbol ${result.nodes.symbol}, entrypoint ${result.nodes.entrypoint}, author ${result.nodes.author}, commit ${result.nodes.commit})`,
  );
  console.log(
    `loaded: ${result.edges.total} edges (imports ${result.edges.imports}, defines ${result.edges.defines}, calls ${result.edges.calls}, handledBy ${result.edges.handledBy}, changed ${result.edges.changed}, authored ${result.edges.authored}, coChanged ${result.edges.coChanged})`,
  );
}
