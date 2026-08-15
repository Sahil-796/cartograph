/**
 * Loads the repo-root `.env` into `process.env` before any test imports
 * `@cartograph/graph` — its query modules transitively import
 * `../driver.js`, which imports `@cartograph/config`, a singleton that
 * validates `process.env` at import time and `process.exit(1)`s if
 * required vars are missing. Same helper/rationale as
 * `packages/graph/src/scripts/load-env.ts` and its test; duplicated
 * (rather than deep-imported from `@cartograph/graph/src/...`) so this
 * package doesn't reach past `@cartograph/graph`'s public entrypoint.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRootEnvPath = path.resolve(here, "../../../.env");
loadDotenv({ path: repoRootEnvPath });
