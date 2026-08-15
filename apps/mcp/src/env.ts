import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

/**
 * Loads the repo-root `.env` into `process.env` *before* anything imports
 * `@cartograph/graph` — same reasoning as
 * `packages/graph/src/scripts/load-env.ts`: `@cartograph/config` validates
 * `process.env` at import time and `process.exit(1)`s on failure, so env
 * vars must already be present by the time that import happens.
 *
 * Resolved relative to this file's own location (not `process.cwd()`) so
 * it finds the same `.env` regardless of where `cartograph-mcp` is
 * launched from — Claude Code launches MCP servers with an arbitrary cwd.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRootEnvPath = path.resolve(here, "../../../.env");
loadDotenv({ path: repoRootEnvPath });
