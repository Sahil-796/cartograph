import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AuthorNode, CommitNode, TouchedEdge } from "./payload.js";

const execFileAsync = promisify(execFile);

/**
 * Record separator between commits in the `git log` output below. Chosen
 * to be a control character (Record Separator, 0x1E) that can never
 * legitimately appear in a commit subject line, so a subject containing
 * arbitrary punctuation (including our field separator character, if it
 * somehow collided) still can't be mistaken for a commit boundary.
 */
const RECORD_SEP = "\x1e";

/**
 * Field separator between the commit metadata fields (sha, author name,
 * author email, ISO date, subject) within one `--pretty=format` record.
 * Also a control character (Unit Separator, 0x1F) for the same reason as
 * `RECORD_SEP` — a commit subject can contain almost any printable text,
 * so only a byte outside the printable range is safe to split on.
 */
const FIELD_SEP = "\x1f";

/** Static bot-identity conventions. See `isBotIdentity` for how these are applied. */
const BOT_NAME_PATTERNS = [/dependabot/i, /renovate/i, /github-actions/i, /\[bot\]$/i];
const BOT_EMAIL_PATTERNS = [
  /dependabot/i,
  /renovate/i,
  /github-actions/i,
  /\[bot\]/i,
  /-ci@/i,
];

/**
 * True when the given commit-author name/email matches a static bot
 * convention. This is a pattern fact (does the identity string match one
 * of these shapes), not a judgment call about the commit's content:
 *   - name or email contains "dependabot" (case-insensitive)
 *   - name or email contains "renovate" (case-insensitive)
 *   - name or email contains "github-actions" (case-insensitive)
 *   - name ends with "[bot]", or email contains "[bot]" (case-insensitive)
 *   - email local-part ends in "-ci" before the "@" (case-insensitive),
 *     e.g. `foo-ci@example.com`
 */
function isBotIdentity(name: string, email: string): boolean {
  return (
    BOT_NAME_PATTERNS.some((re) => re.test(name)) ||
    BOT_EMAIL_PATTERNS.some((re) => re.test(email))
  );
}

/**
 * One parsed `--numstat` line for a single (commit, file) pair, before
 * rename resolution.
 */
interface RawNumstatLine {
  additions: number | null;
  deletions: number | null;
  /** Raw path field from numstat — may be a rename shorthand like `a/{b => c}/d.ts` or `old.ts => new.ts`. */
  pathField: string;
}

/**
 * Resolves a `--numstat` path field to the single repo-relative path it
 * should be attributed to.
 *
 * Rename handling: numstat reports renames either as a full `old => new`
 * line, or with the common-prefix shorthand `a/{old => new}/b.ts`. In
 * both cases we attribute the change to the file's path *after* the
 * rename (`new`) — that's the path that exists in the tree afterwards
 * and the one later commits will keep touching, so churn/co-change
 * counts accumulate against one stable identity instead of splitting
 * across the old and new names. The pre-rename path is discarded; we do
 * not emit a second `TouchedEdge` for it.
 */
function resolveNumstatPath(pathField: string): string {
  const braceMatch = pathField.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braceMatch) {
    const [, prefix, , after, suffix] = braceMatch;
    return `${prefix}${after}${suffix}`.replace(/\/{2,}/g, "/");
  }

  const plainMatch = pathField.match(/^(.*) => (.*)$/);
  if (plainMatch) {
    return plainMatch[2] ?? pathField;
  }

  return pathField;
}

/**
 * Parses one `--numstat` line, e.g. `12\t4\tsrc/foo.ts` or
 * `-\t-\tassets/logo.png` (binary — numstat emits `-` for both counts).
 * Returns `null` for lines that don't look like numstat rows (blank
 * separator lines between commits).
 */
function parseNumstatLine(line: string): RawNumstatLine | null {
  const match = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/);
  if (!match) return null;
  const [, add, del, pathField] = match;
  return {
    additions: add === "-" ? null : Number(add),
    deletions: del === "-" ? null : Number(del),
    pathField: pathField ?? "",
  };
}

/**
 * Runs `git log --numstat --no-merges` once against `repoDir` and parses
 * commits, authors, and per-file touch stats out of a single pass.
 *
 * Design notes:
 *   - Merge commits are excluded (`--no-merges`): their numstat is a diff
 *     against an arbitrary merge-base and double-counts churn already
 *     attributed to the merged commits themselves.
 *   - A single `--pretty=format` line per commit carries sha/author
 *     name/author email/ISO date/subject, separated by a control
 *     character (`FIELD_SEP`) that can't appear in ordinary git metadata,
 *     so a subject line containing arbitrary text (including tabs,
 *     "=>", or other characters `--numstat` itself uses) can't corrupt
 *     the split. Commits are separated by another control character
 *     (`RECORD_SEP`).
 *   - `.mailmap` is applied by git itself to `%an`/`%ae` when a
 *     `.mailmap` file is present in the repo — we don't re-implement
 *     that resolution, only the post-mailmap normalisation (trim +
 *     lowercase email) on top of it.
 *   - Binary files: `--numstat` reports `-`/`-` for additions/deletions
 *     on binary files (it can't compute a line diff). We keep the
 *     `TouchedEdge` (the file *was* touched — that's still a fact worth
 *     recording for co-change purposes) but record `additions`/
 *     `deletions` as `0` rather than `NaN`, since there is no line count
 *     to report.
 *   - Renames: see `resolveNumstatPath`.
 *
 * @param repoDir Absolute path to a local git repository's working directory.
 * @param repoId The `RepoNode.id` to stamp onto every returned record.
 * @throws If `repoDir` is not a git repository (`git log` exits non-zero).
 */
export async function extractHistory(
  repoDir: string,
  repoId: string,
): Promise<{ authors: AuthorNode[]; commits: CommitNode[]; touched: TouchedEdge[] }> {
  const pretty = `${RECORD_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%s`;

  let stdout: string;
  try {
    const result = await execFileAsync(
      "git",
      ["log", "--no-merges", `--pretty=format:${pretty}`, "--numstat"],
      {
        cwd: repoDir,
        maxBuffer: 1024 * 1024 * 1024, // 1GB — large repos can have very long logs
        encoding: "utf8",
      },
    );
    stdout = result.stdout;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`extractHistory: '${repoDir}' is not a readable git repository: ${cause}`);
  }

  const commits: CommitNode[] = [];
  const touched: TouchedEdge[] = [];
  // Preserves first-seen order while letting us overwrite `name` with the
  // last-seen value per the AuthorNode.name contract ("last-seen wins").
  const authorsByEmail = new Map<string, AuthorNode>();

  // Split on the record separator; the first chunk (before the first
  // RECORD_SEP) is empty since the format string starts with it.
  const records = stdout.split(RECORD_SEP).filter((r) => r.length > 0);

  for (const record of records) {
    const newlineIdx = record.indexOf("\n");
    const headerLine = newlineIdx === -1 ? record : record.slice(0, newlineIdx);
    const body = newlineIdx === -1 ? "" : record.slice(newlineIdx + 1);

    const fields = headerLine.split(FIELD_SEP);
    const [sha, authorName, authorEmailRaw, authorDate, subject] = fields;
    if (!sha || !authorEmailRaw || !authorDate) continue; // defensive: malformed record

    const authorEmail = authorEmailRaw.trim().toLowerCase();
    const name = (authorName ?? "").trim();

    authorsByEmail.set(authorEmail, {
      repoId,
      email: authorEmail,
      name,
      isBot: isBotIdentity(name, authorEmail),
    });

    commits.push({
      repoId,
      sha,
      authorEmail,
      timestamp: authorDate,
      message: subject ?? "",
    });

    for (const line of body.split("\n")) {
      if (line.trim().length === 0) continue;
      const parsed = parseNumstatLine(line);
      if (!parsed) continue;

      touched.push({
        repoId,
        sha,
        path: resolveNumstatPath(parsed.pathField),
        additions: parsed.additions ?? 0,
        deletions: parsed.deletions ?? 0,
      });
    }
  }

  return {
    authors: Array.from(authorsByEmail.values()),
    commits,
    touched,
  };
}
