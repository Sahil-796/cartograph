/**
 * Loads the monorepo-root `.env` into `process.env` BEFORE anything imports
 * `@cartograph/config`, whose validated singleton is built from `process.env`
 * at import time and `process.exit(1)`s if a required var is missing. Import
 * this module FIRST in `main.ts` so its side effect runs before `AppModule`
 * (and therefore `@cartograph/config`) is evaluated.
 *
 * Both `pnpm --filter @cartograph/api start` and `start:dev` run with the
 * package dir (`apps/api`) as the cwd, so the repo-root `.env` is two levels
 * up. Real environment variables (Docker, CI) always take precedence —
 * dotenv never overrides an already-set var — so this is a safe no-op there,
 * and if no `.env` exists dotenv does nothing and config's own fail-fast
 * message still names any missing var.
 */
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: resolve(process.cwd(), '../../.env') });
