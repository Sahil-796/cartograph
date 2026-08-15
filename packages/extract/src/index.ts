/**
 * `@cartograph/extract` — a pure repo-to-graph extractor.
 *
 * A local repository path in, a {@link GraphPayload} out: files, symbols,
 * imports, calls, entrypoints, commits, authors and their relationships,
 * derived from the AST (ts-morph) and `git log`. No database, no network,
 * no HTTP. Phase 3 loads the payload straight into CognoDB.
 */

// The one public entrypoint.
export { extractRepo } from "./extract.js";
export type { ExtractOptions } from "./extract.js";

// The contract Phase 3 consumes.
export * from "./payload.js";

// Building blocks, exported for reuse and targeted testing.
export { walkRepo, countLines } from "./walk.js";
export type { WalkedFile } from "./walk.js";
export { createProject, addSourceFiles } from "./project.js";
export { extractCode } from "./code.js";
export type { CodeExtraction } from "./code.js";
export { extractHistory } from "./git.js";
export { computeCoChange } from "./cochange.js";
