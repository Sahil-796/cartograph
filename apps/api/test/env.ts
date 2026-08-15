/**
 * Loads the repo-root `.env` into `process.env` before any test imports
 * a module that transitively pulls in `@cartograph/config` (via the
 * dynamic `@cartograph/graph` import in `graph-loader.ts`). Same
 * helper/rationale as `packages/graph/src/scripts/load-env.ts` — the
 * config singleton validates `process.env` at import time and
 * `process.exit(1)`s if required vars are missing.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRootEnvPath = path.resolve(here, '../../../.env');
loadDotenv({ path: repoRootEnvPath });
