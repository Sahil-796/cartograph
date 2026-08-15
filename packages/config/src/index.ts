import { ConfigValidationError, parseConfig } from "./schema.js";
import type { Config } from "./schema.js";

export { configSchema, parseConfig, ConfigValidationError, formatIssues } from "./schema.js";
export type { Config } from "./schema.js";

/**
 * The validated config singleton, built from `process.env` at module load
 * time (fail-fast). If validation fails, a readable multi-line message
 * naming each missing/invalid variable is printed to stderr and the
 * process exits with code 1 — no unhandled throw / stack trace.
 */
export const config: Config = loadConfig();

function loadConfig(): Config {
  try {
    return parseConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      // eslint-disable-next-line no-console
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
