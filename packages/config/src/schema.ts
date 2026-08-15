import { z } from "zod";

/**
 * Zod schema for every environment variable Cartograph needs at runtime.
 * This is the single source of truth for config shape/validation.
 */
export const configSchema = z.object({
  COGNODB_URI: z
    .string({ required_error: "COGNODB_URI is required" })
    .url("COGNODB_URI must be a valid URL (e.g. bolt://localhost:7687)"),
  COGNODB_USER: z
    .string({ required_error: "COGNODB_USER is required" })
    .min(1, "COGNODB_USER must not be empty"),
  COGNODB_PASSWORD: z
    .string({ required_error: "COGNODB_PASSWORD is required" })
    .min(1, "COGNODB_PASSWORD must not be empty"),
  REDIS_URL: z
    .string({ required_error: "REDIS_URL is required" })
    .url("REDIS_URL must be a valid URL (e.g. redis://localhost:6379)"),
  GROQ_API_KEY: z
    .string({ required_error: "GROQ_API_KEY is required" })
    .min(1, "GROQ_API_KEY must not be empty"),
});

/** The validated, typed application config. */
export type Config = z.infer<typeof configSchema>;

/**
 * Thrown by {@link parseConfig} when environment variables fail validation.
 * Carries the raw zod issues so callers can format them however they like.
 */
export class ConfigValidationError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(issues: z.ZodIssue[]) {
    super(formatIssues(issues));
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

/**
 * Formats zod issues into a readable, multi-line message that names each
 * missing/invalid variable — one line per issue.
 */
export function formatIssues(issues: z.ZodIssue[]): string {
  const lines = issues.map((issue) => {
    const varName = issue.path.join(".") || "(unknown)";
    return `  - ${varName}: ${issue.message}`;
  });
  return ["Invalid environment configuration:", ...lines].join("\n");
}

/**
 * Pure function that validates a raw environment object against the config
 * schema. Throws {@link ConfigValidationError} on failure. Does not touch
 * process.exit or stdout — safe to unit test.
 */
export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues);
  }
  return result.data;
}
