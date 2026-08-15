/**
 * URL parsing + repoId derivation — the pure, network-free core of the
 * ingest gate. Kept in its own module (no imports of config/graph/git) so
 * it can be unit-tested without any env, DB, or filesystem in play.
 */

/** A parsed `owner`/`repo` pair plus the canonical clone URL. */
export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  /** Canonical `https://github.com/{owner}/{repo}.git` clone URL. */
  cloneUrl: string;
}

/**
 * Parses a GitHub repo URL into `{ owner, repo }`. Accepts the forms a
 * user is likely to paste:
 *   - `https://github.com/owner/repo`
 *   - `https://github.com/owner/repo.git`
 *   - `http://github.com/owner/repo/` (trailing slash / extra path segments
 *     beyond owner/repo are ignored)
 *   - `github.com/owner/repo` (scheme optional)
 *
 * Anything that is not a github.com URL with at least an owner and repo
 * segment returns `null` — the caller turns that into an
 * `IngestRejected("invalid_url", …)`. `www.github.com` is accepted;
 * gists, other hosts, and SSH (`git@github.com:…`) are not (the demo
 * clones over HTTPS only).
 */
export function parseGitHubUrl(input: string): ParsedGitHubUrl | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  // Make the scheme optional without a regex zoo: prepend one when absent
  // so the WHATWG URL parser can do the structural work.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;

  // `/owner/repo/...` → ["owner", "repo", ...]; ignore anything past repo.
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  if (segments.length < 2) return null;

  const owner = segments[0];
  let repo = segments[1];
  if (repo.toLowerCase().endsWith(".git")) repo = repo.slice(0, -4);
  if (owner === "" || repo === "") return null;

  return {
    owner,
    repo,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
  };
}

/**
 * Deterministic repoId slug from `owner/repo`:
 * lowercase, then every run of non-alphanumeric characters becomes a
 * single `-`, with leading/trailing dashes trimmed. Owner and repo are
 * joined so the id is globally unique per GitHub repo.
 *
 *   deriveRepoId("honojs", "hono")        === "honojs-hono"
 *   deriveRepoId("drizzle-team", "drizzle-orm") === "drizzle-team-drizzle-orm"
 *
 * Note this never collides with the three seeded/pinned ids
 * (`hono`, `drizzle-orm`, `papermark`): those are bare repo names, whereas
 * every derived id carries the `owner-` prefix.
 */
export function deriveRepoId(owner: string, repo: string): string {
  return `${owner}-${repo}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
