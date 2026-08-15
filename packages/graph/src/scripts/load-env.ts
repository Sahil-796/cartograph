import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

/**
 * Loads the repo-root `.env` into `process.env` *before* anything imports
 * `@cartograph/config` — the config singleton validates `process.env` at
 * import time and `process.exit(1)`s on failure, so env vars must already
 * be present by the time that import happens.
 *
 * Resolved relative to this file's own location (not `process.cwd()`) so
 * it finds the same `.env` regardless of whether the script is invoked
 * from the repo root or from `packages/graph/`. If the file is missing,
 * `dotenv` silently no-ops and lets `@cartograph/config` report the
 * missing variables with its readable message — that's the desired
 * fail-fast behavior, not a "file not found" crash.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRootEnvPath = path.resolve(here, "../../../../.env");
loadDotenv({ path: repoRootEnvPath });
