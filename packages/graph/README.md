# @cartograph/graph

Graph-database layer for Cartograph: a process-lifetime `neo4j-driver` singleton talking
openCypher over Bolt to CognoDB, plus the schema (indexes) the rest of the app depends on.

## What's here

- `src/driver.ts` — the one driver instance for the process (`getDriver()`), a `withSession`
  helper for per-unit-of-work sessions, `verifyConnectivityAndLog()` (logs the negotiated
  Bolt protocol version and server agent), and `closeDriver()` for graceful shutdown.
- `src/schema.ts` — the five `CREATE INDEX ... IF NOT EXISTS` statements and `initSchema()`
  (idempotent — safe to run more than once).
- `src/scripts/db-init.ts` / `src/scripts/db-ping.ts` — runnable entry points, see below.

`neo4j-driver` is pinned to an **exact** version (no `^`/`~`). CognoDB only speaks Bolt
5.0–5.4; an unpinned driver bump could silently negotiate a higher protocol and fail in a
confusing way, so the version is locked deliberately.

## Scripts

```
pnpm --filter @cartograph/graph db:init   # verify connectivity, then ensure all 5 indexes exist
pnpm --filter @cartograph/graph db:ping   # verify connectivity, RETURN 1, print Bolt version + server agent
```

Both require a **provisioned CognoDB instance** and a populated `.env` at the repo root
(`COGNODB_URI`, `COGNODB_USER`, `COGNODB_PASSWORD`, plus the other vars `@cartograph/config`
validates). Without a valid `.env`, both scripts fail fast with a readable message naming the
missing/invalid variables — not a driver stack trace.
