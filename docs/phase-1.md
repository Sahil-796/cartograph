# Phase 1 — Foundation

> **Status:** In progress · Wave 1 (foundation + config) ✅ reviewed & accepted, Wave 2 (graph + api) running.
> **Branch:** `phase-1-foundation` · **Baseline commit:** `6ca8cde`
> Last updated as work lands — sections marked _pending_ are not yet verified.

## Goal

Prove the database connection and the project skeleton **before** writing anything that
depends on them. Per the plan: "A connectivity surprise found here is a nuisance; found in
phase 4 it is the submission." Phase 1 ships no product features — it de-risks the
foundation and establishes the structure every later phase builds on.

## Scope of this phase

1. Monorepo skeleton — pnpm workspaces over `packages/*` and `apps/*`.
2. `packages/config` — one zod schema validating all environment variables, fail-fast at
   load with a readable error that names the offending variable.
3. `packages/graph/src/driver.ts` — a single pinned `neo4j-driver`, `verifyConnectivity()`
   at boot, negotiated Bolt version logged.
4. `packages/graph/src/schema.ts` — the five `CREATE INDEX ... IF NOT EXISTS` statements,
   exposed as `pnpm db:init`; plus `pnpm db:ping`.
5. `apps/api` NestJS skeleton + a `Dockerfile` that **installs git** (the ingestion worker
   shells out to `git clone` / `git log`, and slim/alpine base images omit git).

## Key decisions (and why)

These come from `plan.html` §00 as sharpened by the grilling-session revisions callout.

| Decision | Choice | Why it matters here |
|----------|--------|---------------------|
| Runtime / package manager | **Node 20 · pnpm workspaces** | Not Bun / Turborepo. One toolchain, standard, deploys cleanly. |
| Env handling | **zod schema, fail-fast at boot** | A bad credential should exit with one readable line naming the var — never a driver stack trace on the first query. This is an explicit grading item. |
| Env vars | `COGNODB_URI`, `COGNODB_USER`, `COGNODB_PASSWORD`, `REDIS_URL`, `ANTHROPIC_API_KEY` | `REDIS_URL` added for BullMQ ingestion queue (grilling revision). `.env.example` committed; `.env` never committed. |
| Driver lifecycle | **One driver per process, sessions per request** | 200 connections is the free-tier ceiling; a driver-per-request exhausts it. |
| Bolt version | **Pin `neo4j-driver` exactly, log negotiated version** | CognoDB speaks Bolt 5.0–5.4; a current driver may negotiate above that. An unpinned bump is a silent, confusing failure later. |
| Deploy target | Frontend → Vercel; API + worker → **Azure Container Apps, one app, min=max=1** | The polling worker must stay alive — no scale-to-zero. |
| Dockerfile | **Installs `git`** | The worker shells out to `git`; slim/alpine base images omit it. Added in Phase 1, not later. |

## What was built

### Monorepo substrate — ✅ Wave 1

pnpm workspace over `packages/*` and `apps/*`. Root `package.json` (`packageManager:
pnpm@9.12.0`, ESM, `-r` build/typecheck scripts), `pnpm-workspace.yaml`, `tsconfig.base.json`
(ES2022, NodeNext, strict, composite, isolatedModules), `.gitignore`, `.env.example`
(all 5 vars documented), `README.md` stub. Placeholder members created for
`packages/{extract,tools}` and `apps/{cli,web,mcp}` — each a `package.json` +
`tsconfig.json` + `src/index.ts` stub so the workspace resolves. `packages/graph` and
`apps/api` intentionally left for Wave 2.

Commits: `561095c` (root config), `23372d0` (placeholder members).

### `packages/config` — ✅ Wave 1

The single source of truth for environment configuration; every other package imports it.

**Public API** (`@cartograph/config`):

| Export | What it is |
|--------|-----------|
| `config: Config` | Validated singleton, built from `process.env` **at import time**. On failure prints a readable multi-line message and `process.exit(1)` — never a raw stack trace. |
| `type Config` | `{ COGNODB_URI, COGNODB_USER, COGNODB_PASSWORD, REDIS_URL, ANTHROPIC_API_KEY }`, all `string`. |
| `parseConfig(env)` | Pure validator — **throws** `ConfigValidationError`, never exits. Use this in tests/tools. |
| `ConfigValidationError` | `Error` with `.issues: ZodIssue[]` and a pre-formatted `.message`. |
| `configSchema`, `formatIssues` | Raw zod schema and the message formatter, for composition. |

**Verified (actually ran):** `pnpm install` resolved all 7 workspace projects; config
tests **4/4 pass** (valid env; missing var named; invalid URL named; all 5 missing reported
at once); `tsc --noEmit` clean.

Commits: `1deda26` (implementation), `ca7cfba` (tests).

> **Integration note for downstream units.** `@cartograph/config` `main` points at raw
> `./src/index.ts` (source-level workspace imports). So anything runnable — `db:init`,
> `db:ping`, the API — must run under a TypeScript runtime (**tsx**), and must load `.env`
> into `process.env` **before** importing the `config` singleton (which exits on missing
> env). Node 20's `--env-file=.env` or `import "dotenv/config"` both work.

### `packages/graph` (driver + schema) — ✅ Wave 2a

The database access layer. `@cartograph/graph`, ESM, depends on `@cartograph/config`
(`workspace:*`) and **`neo4j-driver` pinned to exactly `5.28.3`** (no caret — a future 5.x/6.x
bump could negotiate a Bolt version above CognoDB's 5.0–5.4 range and fail silently).

- `src/driver.ts` — lazy **process-lifetime singleton** `getDriver()` (importing the module
  opens no socket), `withSession(fn)` (closes the session in `finally`), `closeDriver()`, and
  `verifyConnectivityAndLog()` which logs the **negotiated Bolt protocol version**
  (`ServerInfo.protocolVersion`, e.g. `5.4`) + server agent.
- `src/schema.ts` — the five `CREATE INDEX ... IF NOT EXISTS` statements + idempotent
  `initSchema()`.
- `src/scripts/{db-init,db-ping}.ts` + `load-env.ts` — the runnable exit-test scripts (via
  `tsx`); `load-env` loads the repo-root `.env` before `@cartograph/config` evaluates.
- `db:init` / `db:ping` scripts exposed in the package; a root passthrough is added at finalize.

**Verified (no live DB — the reachable surface):** typecheck clean; `db:ping` with **no
`.env`** → the readable config error naming all 5 vars, no stack trace; `db:ping` with a
**bogus-but-present** `.env` → past config validation, real driver *connection* error. This
proves the config→driver→env wiring end to end; only the live round-trip waits on CognoDB.

Commits: `e1dc0b4` (driver + schema), `52b22d3` (scripts + exports), `7ba47c0` (README).

### `apps/api` skeleton + Dockerfile — ⏳ Wave 2b (running)

## Deviations from the plan (plan vs actual)

The plan is a design written before code; these are the places the build genuinely differs
from `plan.html`. Recorded so a reviewer sees the reasoning, not a contradiction.

| Plan says | What we actually did | Why |
|-----------|----------------------|-----|
| Bun · Turborepo · Next.js (plan body) | **Node · pnpm workspaces · React/Vite · NestJS** | Superseded by the grilling-session revisions callout at the top of `plan.html`. That callout is authoritative. |
| `apps/worker` as a separate app | **No `apps/worker`** — the ingestion worker runs inside `apps/api` as a BullMQ forked processor | One deploy, one container; Redis does the locking. (Wired in a later phase; only the `apps/api` skeleton lands in Phase 1.) |
| Env vars: 4 (CognoDB ×3 + Anthropic) | **5 — added `REDIS_URL`** | BullMQ ingestion queue needs Redis (Upstash free tier). |
| `bun run db:init` / `db:ping` | **`pnpm`**, and the scripts live in `@cartograph/graph`; a root passthrough (`pnpm db:init`) is added by the orchestrator | pnpm workspaces; keeps the DB scripts co-located with the driver they use. |
| (unspecified) build/runtime story | **Source-level TS imports run via `tsx`** — `@cartograph/config` `main` points at raw `src/index.ts`, no build step in Phase 1 | Lighter for a foundation phase; a production build pipeline is deferred to when an app needs to ship a compiled bundle. |
| (orchestration) parallel fan-out | **Wave 2 run sequentially, not in parallel worktrees** | Git worktree isolation was unavailable (repo was `git init`'d mid-session, so the harness treats it as non-git). Two agents sharing one tree would race `pnpm install`/lockfile/git index, so units were serialized. Correctness over speed. |

## How to run it

_Filled in once the scaffold is verified. Expected shape:_

```bash
pnpm install
pnpm db:init   # creates the 5 indexes; idempotent
pnpm db:ping   # round-trips RETURN 1, prints server + negotiated Bolt version
```

## Exit test (from the plan)

| Check | Status |
|-------|--------|
| `db:init` succeeds, and again on a second run (idempotent) | ⏳ gated on live CognoDB instance |
| `db:ping` round-trips `RETURN 1` and prints the server version | ⏳ gated on live CognoDB instance |
| Corrupt/absent env → readable error naming the var, not a stack trace | ✅ verified (config + graph `db:ping` no-`.env` run) |

> **Blocker (expected, not a failure):** the CognoDB c0 instance is provisioned manually in
> the vendor console — signup, create instance, capture the one-time password. That step
> needs the user's credentials and cannot be automated. All code is written and reviewable
> without it; only the two connectivity checks above wait on `COGNODB_URI` + password
> existing in `.env`. Provisioning is walked through with the user after scaffolding.
</content>
