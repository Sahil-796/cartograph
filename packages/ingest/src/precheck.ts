/**
 * The fast, clone-free gate. Given a GitHub URL it parses owner/repo,
 * asks the GitHub REST API (unauthenticated) for the repo's metadata, and
 * enforces every guardrail reachable *before* paying for a clone: URL
 * validity, existence, size, and primary language. It also reports whether
 * the repo is already in the DB so the pipeline can serve it from cache.
 *
 * Guardrails still enforced only *after* clone (source-file count) live in
 * `pipeline.ts`, not here — this module never touches disk or git.
 */
import { IngestRejected } from "./errors.js";
import { parseGitHubUrl, deriveRepoId } from "./slug.js";
import { repoExists as dbRepoExists } from "./db.js";
import type { PrecheckResult } from "./types.js";

/** Guardrail limits, in one place so the numbers are auditable. */
export const SIZE_LIMIT_KB = 51_200; // 50 MB; GitHub `size` is in KB.
export const SUPPORTED_LANGUAGES = ["typescript", "javascript"] as const;

/** The slice of GitHub's `/repos/{owner}/{repo}` response we rely on. */
interface GitHubRepoMeta {
  size: number;
  language: string | null;
}

/** Injectable seams so the pure guardrail logic is testable without a network or DB. */
export interface PrecheckDeps {
  /** Defaults to global `fetch`. */
  fetchFn?: typeof fetch;
  /** Defaults to the real DB lookup. */
  repoExistsFn?: (repoId: string) => Promise<boolean>;
}

function formatMb(sizeKb: number): string {
  const mb = sizeKb / 1024;
  // Whole numbers read cleaner in the rejection copy ("180 MB", not "180.0 MB").
  return Number.isInteger(mb) ? `${mb} MB` : mb.toFixed(0) + " MB";
}

function isSupportedLanguage(language: string | null): boolean {
  if (language === null) return false;
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(language.toLowerCase());
}

/**
 * Runs the pre-clone gate. Throws {@link IngestRejected} on any guardrail
 * failure (`invalid_url` / `not_found` / `too_large` / `unsupported_language`);
 * returns the parsed identity + metadata on success.
 */
export async function precheckRepo(url: string, deps: PrecheckDeps = {}): Promise<PrecheckResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const repoExistsFn = deps.repoExistsFn ?? dbRepoExists;

  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    throw new IngestRejected(
      "invalid_url",
      "That doesn't look like a GitHub repo URL — paste something like https://github.com/owner/repo.",
    );
  }

  const { owner, repo } = parsed;
  const repoId = deriveRepoId(owner, repo);

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const res = await fetchFn(apiUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      // GitHub requires a User-Agent on API requests; omit it and you get 403.
      "User-Agent": "cartograph-ingest",
    },
  });

  if (res.status === 404) {
    throw new IngestRejected("not_found", "No public repo found at that URL.");
  }
  if (!res.ok) {
    // 403 (rate limit), 5xx, etc. — not a guardrail decision, an outage.
    throw new Error(`GitHub API returned ${res.status} for ${owner}/${repo}`);
  }

  const meta = (await res.json()) as GitHubRepoMeta;

  if (typeof meta.size === "number" && meta.size > SIZE_LIMIT_KB) {
    throw new IngestRejected(
      "too_large",
      `This repo is ${formatMb(meta.size)} — the demo handles repos under 50 MB.`,
    );
  }

  const language = meta.language ?? null;
  if (!isSupportedLanguage(language)) {
    const what = language ? `this repo is mostly ${language}` : "this repo has no detected TypeScript or JavaScript";
    throw new IngestRejected(
      "unsupported_language",
      `Cartograph only understands TypeScript and JavaScript; ${what}.`,
    );
  }

  const alreadyIngested = await repoExistsFn(repoId);

  return {
    owner,
    repo,
    repoId,
    sizeKb: meta.size,
    language,
    alreadyIngested,
  };
}
