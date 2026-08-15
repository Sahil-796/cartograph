# @cartograph/config

Single source of truth for Cartograph's environment configuration. Validates
`COGNODB_URI`, `COGNODB_USER`, `COGNODB_PASSWORD`, `REDIS_URL`, and
`GROQ_API_KEY` against a zod schema.

- Importing `config` from this package parses `process.env` at load time
  (fail-fast). On invalid/missing vars it prints a readable message naming
  each offending variable and exits the process — no stack trace.
- `parseConfig(env)` is the pure validator underneath, safe to unit test
  without killing the process. It throws `ConfigValidationError` on failure.

## Running tests

```
pnpm --filter @cartograph/config test
```
