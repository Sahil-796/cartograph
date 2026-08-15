import { basename, resolve as resolvePath } from "node:path";
import { countLines, walkRepo } from "./walk.js";
import { addSourceFiles, createProject } from "./project.js";
import { extractCode } from "./code.js";
import { extractHistory } from "./git.js";
import { computeCoChange } from "./cochange.js";
import type {
  AuthorNode,
  CommitNode,
  FileNode,
  GraphPayload,
  RepoNode,
  TouchedEdge,
} from "./payload.js";

/** Options for {@link extractRepo}. */
export interface ExtractOptions {
  /**
   * Stable repo id used on every node/edge. Defaults to a slug of the repo
   * name (which itself defaults to the root directory's basename).
   */
  repoId?: string;
  /** Human-readable repo name. Defaults to the root directory's basename. */
  repoName?: string;
  /**
   * Whether to read git history (commits, authors, churn, co-change).
   * Defaults to `true`. When the target isn't a git repository, history is
   * skipped gracefully (a warning to stderr) rather than failing the whole
   * extraction — a plain folder still yields a complete code graph.
   */
  history?: boolean;
}

/**
 * The one public entrypoint of `packages/extract`: a local repo path in, a
 * complete {@link GraphPayload} out. Pure with respect to the outside world
 * — it reads the filesystem and shells out to `git log`, but touches no
 * database, network, or HTTP. This is the composition the whole package
 * exists to provide; Phase 3 loads its output straight into CognoDB.
 *
 * Pipeline: `walk` (discover files) → `ts-morph` project (parse) →
 * `extractCode` (symbols, imports, calls, entrypoints) + `extractHistory`
 * (git) → `computeCoChange` (coupling) → assemble. The call-resolution rate
 * — the extractor's headline honesty metric — is computed here from the
 * code pass's raw counts.
 */
export async function extractRepo(
  repoPath: string,
  options: ExtractOptions = {},
): Promise<GraphPayload> {
  const rootDir = resolvePath(repoPath);
  const repoName = options.repoName ?? basename(rootDir);
  const repoId = options.repoId ?? slugify(repoName);
  const repo: RepoNode = { id: repoId, name: repoName };

  // 1. Discover source files (globbed, test/generated-classified).
  const walked = walkRepo(rootDir);

  // 2. Parse every file once into a shared ts-morph project.
  const project = createProject(rootDir);
  addSourceFiles(project, walked.map((f) => f.absPath));

  // 3. Code-derived facts: symbols, defines, imports, calls, entrypoints.
  const code = extractCode(project, walked, repoId);

  // 4. File nodes — `loc` is computed here (not carried by the walker).
  const files: FileNode[] = walked.map((f) => ({
    repoId,
    path: f.relPath,
    ext: f.ext,
    loc: countLines(f.absPath),
    isTest: f.isTest,
    isGenerated: f.isGenerated,
  }));

  // 5. Git history — optional and non-fatal when the target isn't a repo.
  let authors: AuthorNode[] = [];
  let commits: CommitNode[] = [];
  let touched: TouchedEdge[] = [];
  if (options.history !== false) {
    try {
      const history = await extractHistory(rootDir, repoId);
      authors = history.authors;
      commits = history.commits;
      touched = history.touched;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[extract] git history skipped for ${rootDir}: ${(err as Error).message}`,
      );
    }
  }

  // 6. Co-change coupling, derived from the touch history.
  const coChanged = computeCoChange(commits, touched, repoId);

  // 7. Honest quality metric — how much of the call graph resolved.
  const callResolutionRate =
    code.callsTotal === 0 ? 1 : code.callsResolved / code.callsTotal;

  return {
    repo,
    files,
    symbols: code.symbols,
    entrypoints: code.entrypoints,
    authors,
    commits,
    imports: code.imports,
    calls: code.calls,
    defines: code.defines,
    handledBy: code.handledBy,
    touched,
    coChanged,
    stats: {
      callsResolved: code.callsResolved,
      callsTotal: code.callsTotal,
      callResolutionRate,
    },
  };
}

/**
 * Lowercase-and-hyphenate a name into a stable repo id. Empty/symbol-only
 * names fall back to `"repo"` so an id is always non-empty.
 */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "repo";
}
