/**
 * The extraction contract.
 *
 * `packages/extract` is a pure function from a local repo path to a
 * `GraphPayload`: no database, no network, no HTTP anywhere in this
 * package. Everything below is a FACT derivable directly from the AST
 * (via ts-morph) or from `git` output — never an inference, score, or
 * heuristic ranking. Phase 3 (graph load) consumes exactly this shape
 * and writes it into CognoDB; changing a field here is a breaking change
 * for that package, so document deviations here rather than silently
 * drifting the shape.
 *
 * Scope: TypeScript/JavaScript only, file-level and top-level-symbol-level
 * only. No expression-level analysis, no full cross-file type resolution.
 */

/** The repository being extracted. Exactly one per payload. */
export interface RepoNode {
  /** Stable identifier for the repo, e.g. a slug derived from its name or path. */
  id: string;
  /** Human-readable repo name (e.g. the directory basename or package name). */
  name: string;
}

/** A single source file discovered by `walkRepo`. */
export interface FileNode {
  /** The `RepoNode.id` this file belongs to. */
  repoId: string;
  /** Repo-relative path, POSIX separators (`/`), e.g. `src/foo/bar.ts`. */
  path: string;
  /** File extension including the leading dot, e.g. `.ts`, `.tsx`, `.js`, `.jsx`. */
  ext: string;
  /** Line count, computed by splitting file contents on `\n`. */
  loc: number;
  /**
   * True when the path matches a test convention: a `__tests__` path
   * segment, a `*.test.*` / `*.spec.*` filename, or a top-level `test`/
   * `tests` directory. See `walk.ts` for the exact rule.
   */
  isTest: boolean;
  /**
   * True when the file looks generated rather than hand-written, e.g.
   * `*.generated.*`. Build output directories (`dist`, `build`, etc.) are
   * excluded from the walk entirely rather than flagged here — see
   * `walk.ts`.
   */
  isGenerated: boolean;
}

/**
 * A top-level named symbol: a function, class, or top-level
 * const/arrow-function declaration. Only symbols with a discoverable
 * name are recorded — anonymous default exports, destructured bindings,
 * etc. are out of scope for Wave 1's contract but the `kind` union may
 * grow as Wave 2 encounters more forms.
 */
export interface SymbolNode {
  /** The `RepoNode.id` this symbol belongs to. */
  repoId: string;
  /**
   * Stable id, always `${path}#${name}` where `path` is the defining
   * file's repo-relative path and `name` is the symbol's declared name.
   * This is the join key used by `DefinesEdge`, `CallsEdge`, and
   * `HandledByEdge`.
   */
  id: string;
  /** The symbol's declared name (function/class/const identifier). */
  name: string;
  /**
   * What kind of declaration this is. Left open-ended (not a closed
   * union) because Wave 2's AST walk may need to add forms (e.g.
   * `method`, `interface`) beyond this initial set without breaking the
   * type; Wave 2 should still restrict itself to a small, documented set
   * of string literals in practice.
   */
  kind: "function" | "class" | "const" | "arrow" | (string & {});
  /** Repo-relative path (posix) of the file that defines this symbol. */
  path: string;
  /** 1-based source line of the declaration. */
  line: number;
  /** True if the declaration is exported (named or default) from its file. */
  exported: boolean;
}

/**
 * An HTTP route or page entrypoint discovered by static convention (e.g.
 * an Express route registration, a Next.js page/route file). Extraction
 * of *which* frameworks/conventions are recognized is Wave 2's job; this
 * type only fixes the shape.
 */
export interface EntrypointNode {
  /** The `RepoNode.id` this entrypoint belongs to. */
  repoId: string;
  /** Stable id for the entrypoint, e.g. `${method} ${route}`. */
  id: string;
  /** Entrypoint kind. Currently always `"route"`; reserved for future kinds. */
  kind: "route";
  /**
   * HTTP method (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, ...), or the
   * literal string `"PAGE"` for framework page routes that aren't tied
   * to a single HTTP verb (e.g. a Next.js page component).
   */
  method: string;
  /** The route path/pattern as written in source, e.g. `/api/users/:id`. */
  route: string;
  /** Repo-relative path (posix) of the file containing the handler. */
  path: string;
}

/** A git commit author, keyed by normalised email. */
export interface AuthorNode {
  /** The `RepoNode.id` this author belongs to. */
  repoId: string;
  /**
   * Normalised email address (lowercased; mailmapped if `git`'s
   * `.mailmap` resolution changes the address for a commit). This is
   * the join key `CommitNode.authorEmail` points at — there is no
   * separate `AuthoredEdge`; see the note on `CommitNode` below.
   */
  email: string;
  /** Author display name as reported by `git` for this email (last-seen wins). */
  name: string;
  /**
   * True when the author looks like an automated identity (e.g. name or
   * email matches a bot convention such as `dependabot[bot]`,
   * `*-ci@*`, `github-actions`). A static-pattern fact, not a judgment.
   */
  isBot: boolean;
}

/** A single git commit. */
export interface CommitNode {
  /** The `RepoNode.id` this commit belongs to. */
  repoId: string;
  /** Full commit SHA. */
  sha: string;
  /**
   * Normalised author email — the join key into `AuthorNode.email`.
   * Authorship is modelled this way (a plain field, not a separate edge
   * array) because it's a strict one-to-one fact per commit; consumers
   * join `CommitNode.authorEmail === AuthorNode.email` within the same
   * `repoId` rather than walking an edge list.
   */
  authorEmail: string;
  /** Commit timestamp as an ISO-8601 string (UTC), taken from `git`'s author date. */
  timestamp: string;
  /** Commit message subject line only (first line of the message), not the full body. */
  message: string;
}

/** File → File: `fromPath` has a static import/require pointing at `toPath`. */
export interface ImportsEdge {
  repoId: string;
  /** Repo-relative path (posix) of the importing file. */
  fromPath: string;
  /** Repo-relative path (posix) of the imported file, resolved to a file in this repo. */
  toPath: string;
}

/** Symbol → Symbol: the symbol at `fromSymbolId` calls the symbol at `toSymbolId`. */
export interface CallsEdge {
  repoId: string;
  /** `SymbolNode.id` of the calling symbol. */
  fromSymbolId: string;
  /** `SymbolNode.id` of the called symbol. */
  toSymbolId: string;
}

/** File → Symbol: `filePath` defines the symbol `symbolId`. */
export interface DefinesEdge {
  repoId: string;
  /** Repo-relative path (posix) of the defining file. */
  filePath: string;
  /** `SymbolNode.id` of the defined symbol. */
  symbolId: string;
}

/**
 * Entrypoint → Symbol: the entrypoint's request handler is the named
 * symbol `symbolId`, defined in file `path`. Both the resolved symbol
 * (when the handler could be matched to a named top-level declaration)
 * and the file it lives in are carried on every edge, so consumers who
 * only care about file-level granularity don't need a second lookup
 * through `DefinesEdge`. `symbolId` is `undefined` when the handler is
 * an inline/anonymous function that couldn't be resolved to a named
 * symbol — in that case the edge still points at `path`.
 */
export interface HandledByEdge {
  repoId: string;
  /** `EntrypointNode.id` of the entrypoint. */
  entrypointId: string;
  /** Repo-relative path (posix) of the file containing the handler. */
  path: string;
  /** `SymbolNode.id` of the handler symbol, when resolvable. */
  symbolId?: string;
}

/** Commit → File: the commit at `sha` touched `path`, with line-level stats from `git`. */
export interface TouchedEdge {
  repoId: string;
  /** `CommitNode.sha` of the commit. */
  sha: string;
  /** Repo-relative path (posix) of the touched file. */
  path: string;
  /** Lines added to `path` by this commit, from `git log --numstat`. */
  additions: number;
  /** Lines deleted from `path` by this commit, from `git log --numstat`. */
  deletions: number;
}

/**
 * File ↔ File: `pathA` and `pathB` were touched together by the same
 * commit at least once. Undirected — `pathA`/`pathB` are ordered only to
 * give the pair a canonical, de-duplicated representation (e.g. sorted
 * lexicographically by the extractor), not to imply direction.
 */
export interface CoChangedEdge {
  repoId: string;
  /** Repo-relative path (posix) of the first file in the pair. */
  pathA: string;
  /** Repo-relative path (posix) of the second file in the pair. */
  pathB: string;
  /** Number of commits that touched both `pathA` and `pathB`. */
  count: number;
  /**
   * Normalised co-change strength in `[0, 1]`, e.g. `count` divided by
   * the number of commits touching the more-frequently-changed of the
   * two files. A plain derived ratio of counts already present in this
   * payload — not a model score.
   */
  strength: number;
}

/**
 * Extraction quality metrics for the whole payload. Populated by Wave 2
 * as it resolves `CallsEdge`s during the AST walk; defined now so the
 * shape is fixed for downstream consumers from the start.
 */
export interface ExtractionStats {
  /** Number of call sites that produced a `Symbol → Symbol` edge. */
  callsResolved: number;
  /**
   * The resolution-rate **denominator**: call sites whose callee resolves
   * to a known in-repo `SymbolNode` — i.e. the calls we actually attempt
   * to trace. Excludes out-of-scope shapes (method/property calls, calls
   * into external packages, unknown globals) that point at nothing in the
   * model; counting those would conflate "out of scope" with "failed to
   * resolve". A call can be in scope yet unresolved when its *caller* is a
   * module-top-level statement with no enclosing symbol to attribute to.
   */
  callsInScope: number;
  /**
   * Every `CallExpression` observed, raw. Reported for honesty so the rate
   * can't hide how much of the source is method/library calls the model
   * doesn't trace. On real TS apps this is many times `callsInScope`.
   */
  callsObserved: number;
  /**
   * `callsResolved / callsInScope`, in `[0, 1]`. `1` when `callsInScope`
   * is `0` (nothing in scope to resolve). The headline honesty metric —
   * of the calls that target a symbol we model, how many we tied back to
   * it. Reported to the UI and fed into every AI tool result.
   */
  callResolutionRate: number;
}

/**
 * The full output of extraction for one repo: everything Phase 3 needs
 * to load a complete graph, and nothing it needs to derive itself.
 */
export interface GraphPayload {
  repo: RepoNode;
  files: FileNode[];
  symbols: SymbolNode[];
  entrypoints: EntrypointNode[];
  authors: AuthorNode[];
  commits: CommitNode[];
  imports: ImportsEdge[];
  calls: CallsEdge[];
  defines: DefinesEdge[];
  handledBy: HandledByEdge[];
  touched: TouchedEdge[];
  coChanged: CoChangedEdge[];
  stats: ExtractionStats;
}
