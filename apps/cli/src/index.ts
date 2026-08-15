#!/usr/bin/env node
/**
 * `cartograph ingest <path>` — the local-CLI door onto the extractor.
 *
 * Three doors feed the same pipeline: this CLI, the web app, and (later)
 * an ingest API. All three call the identical `extractRepo` /
 * `loadPayload` composition; this file's only job is argument parsing,
 * calling those two functions in the right order, and printing an honest
 * summary. It is also the tool that generates the committed `seed/*.json`
 * demo fixtures — `--out` writes exactly the JSON `loadPayload` would
 * otherwise consume.
 */
import { Command } from "commander";
import { runIngest } from "./ingest.js";

const program = new Command();

program
  .name("cartograph")
  .description("Cartograph CLI — turn a repo into a graph")
  .version("0.0.0");

program
  .command("ingest")
  .description("Extract a local repo and load it into CognoDB (or write it to a JSON file)")
  .argument("<path>", "path to a local repo checkout")
  .option("--out <file>", "write the extracted GraphPayload as pretty JSON to <file> instead of loading it into the DB")
  .option("--repo-id <id>", "override the repo id (defaults to a slug of the repo name)")
  .option("--repo-name <name>", "override the human-readable repo name (defaults to the root directory's basename)")
  .option("--pin", "when loading to the DB, mark this repo pinned (never evicted)", false)
  .option("--dry-run", "extract and print stats only — write no JSON, load nothing", false)
  .option("--no-history", "skip git history (commits/authors/co-change) — faster, and the honest mode for a non-git folder")
  .option("--url <url>", "repo URL to store on the Repo node when loading")
  .option(
    "--commits <n>",
    "no-op for a local checkout: history depth is a clone-time concern (`git clone --depth`), not something extraction can retroactively limit. Accepted for compatibility with the plan's flag list; prints a notice and is otherwise ignored.",
  )
  .action(async (path: string, opts: Record<string, unknown>) => {
    try {
      await runIngest(path, opts);
    } catch (err) {
      // Every rejection is a designed state: a one-line, readable message
      // on stderr and a non-zero exit — never a raw stack trace as the
      // primary output.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`cartograph ingest failed: ${message}`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
