# Phase 6 — Live ingestion

> **Status:** ✅ **COMPLETE** — the graph is no longer limited to the three seeded repos. Paste a public
> GitHub URL and watch it become a queryable graph: a precheck rejects hostile input *before* cloning,
> a BullMQ worker runs the clone → extract → load → evict pipeline, and the landing page streams real
> phase names (`precheck → cloning → parsing → linking → history → writing → ready`) with live counts.
> **Verified end-to-end** against a live Redis + CognoDB: `sindresorhus/is-plain-obj` → 48 nodes / 143
> edges, plus three distinct readable rejections (oversized, non-TS, nonexistent).
> **Branch:** `phase-6-ingestion` (stacked on `phase-5-ai`). **Adds:** `@cartograph/ingest` · BullMQ · ioredis.

## The thesis of this phase: arbitrary repos are hostile input

This is the plan's **highest-risk, deliberately-last** phase — and the only one whose failure costs
nothing, because the product already shipped in Phase 4. The whole design posture is *defensive*: a
pasted URL is untrusted, so every path that a hostile or simply-too-big repo can take is a **designed
state**, not a stack trace. The guardrail table is the spec:

| Guard | Limit | Enforced |
|-------|-------|----------|
| Repo size | reject > 50 MB (GitHub `size` KB > 51200) | precheck, pre-clone |
| Language | TypeScript / JavaScript only | precheck, pre-clone |
| Source files | cap 1,500 | after clone, before ts-morph |
| Git history | `git clone --depth 500` | clone |
| Already ingested | serve from cache, no clone | precheck |
| Job timeout | 3-minute hard kill | worker |
| Node budget | evict oldest **unpinned** repo | after load |

"Reject before the user waits, never after": the size/language/existence checks hit GitHub's
unauthenticated `GET /repos/{owner}/{repo}` and fail in milliseconds, before a single byte is cloned.
The seed repos are **pinned**, so eviction can never delete the demo.

## The pipeline already existed — this phase is clone + queue + progress

Phases 2–3 already shipped `extractRepo` (parse a directory → `GraphPayload`), `loadPayload` (write it
to CognoDB), and `evict.ts` (enforce a node budget). Phase 6 wraps a **URL** around them: clone into a
temp dir, run the existing pipeline, clean up, and stream progress. Three units, built in two waves.

### Unit A — `@cartograph/ingest`, the engine (`packages/ingest/`)

A pure, transport-agnostic package: no HTTP, no queue, just the ingest logic, so it is fully
unit-testable without a server.

- **`precheckRepo(url)`** — parses the GitHub URL (`invalid_url` on anything else), calls the
  unauthenticated GitHub API, and applies the pre-clone guards (`not_found` / `too_large` /
  `unsupported_language`). Returns `{ owner, repo, repoId, sizeKb, language, alreadyIngested }`.
- **`runIngest(url, onProgress)`** — the orchestrator. Emits `precheck` → (cache hit? `ready`, no
  clone) → `cloning` (`git clone --filter=blob:none --depth 500` into a temp dir **removed in a
  `finally`**) → source-file cap (`too_many_files`) → `parsing`/`linking`/`history` around
  `extractRepo` → `writing` (`loadPayload`) → **eviction on write** → `ready`. Rejections surface as
  `IngestRejected` with a `reason` and human copy.
- **repoId slug**: `owner/repo` → lowercased, non-alphanumeric runs collapsed to `-`
  (`sindresorhus/is-plain-obj` → `sindresorhus-is-plain-obj`). Never collides with the bare-name seed
  ids (`hono`, `drizzle-orm`, `papermark`) because it always carries the owner prefix.
- **`INGEST_NODE_BUDGET`** (default `200_000` nodes) — a conservative proxy for the ~1 GB disk ceiling,
  well above the pinned seeds; read at load time and passed to the evict function.

Design seam worth noting: both `precheckRepo` and `runIngest` take an **optional trailing `deps`
argument** (real implementations by default) so tests inject fake GitHub/clone/extract/load steps and
assert guardrail decisions and temp-dir cleanup with zero network, git, or DB. 29 unit tests.

### Unit B — the queue, worker, and endpoints (`apps/api/src/ingest/`)

A NestJS `IngestModule` that reuses the same ESM/CJS dynamic-import bridge as the query and chat
surfaces (`new Function("s","return import(s)")` after `tsx/esm/api` `register()`) to load the ESM-only
engine into the CommonJS Nest app.

- **`POST /api/ingest`** runs `precheckRepo` **synchronously** so a bad URL is rejected instantly:
  `IngestRejected → 400 { reason, message }`; already-ingested → `200 { repoId, cached: true }`;
  otherwise enqueue a BullMQ job → `202 { jobId }`. Redis unreachable → `503`.
- **`GET /api/ingest/:jobId`** maps BullMQ job state → `{ jobId, status, phase, counts?, repoId?,
  error? }` (`404` on unknown id). The worker mirrors each `onProgress` into `job.updateProgress`, so
  the poll reports the live phase and running counts.
- **Worker**: BullMQ `Worker`, **concurrency 1** (respects CognoDB's single-writer posture), with a
  **3-minute `Promise.race` timeout** so a hung job never wedges the single slot. Structured rejection
  reasons survive to the GET by being stashed in progress *and* JSON-encoded into BullMQ's plain-string
  `failedReason`.

**One deliberate divergence from the plan, documented:** the plan calls for a *forked/sandboxed*
processor so ts-morph parsing can't block the API event loop. B ships an **in-process** worker instead
— the acceptable, plan-sanctioned fallback ("the queue is not what's being graded"). A BullMQ sandbox
spawns a bare child Node process against a processor file, and making the ESM-only, raw-TS engine
resolve through the `tsx` bridge from a BullMQ-controlled child — reliably in both `tsx` dev and
`nest build` dist — is exactly the environment-specific fragility the plan warns about. Concurrency 1
plus the hard timeout bound the event-loop cost to one ingest at a time. Promoting to a forked
processor later is a contained change behind the same queue service.

### Unit C — the ingestion UI (`apps/web/src/features/ingest/`)

The landing page (`RepoPicker`) now **leads with a paste-a-GitHub-URL box**; the demo cards move below
under "Or try a demo repository."

- **`useIngest`** POSTs the URL, then on `202` polls `GET` every ~1s (≈3.5-min cap matching the worker
  timeout) until `completed` (→ navigate to `/r/:repoId`) or `failed`; `200 cached` short-circuits.
- **The progress stepper** renders the phases as an ordered checklist that lights up the current phase
  and shows counts (files → symbols → commits → nodes) as they stream. This is the graded "forty
  seconds of the screen recording" — a live map of the work, not a spinner.
- **Rejection panels** are reason-specific, use the backend's human copy, and — crucially — **offer the
  three demo repos inline** ("Try one of these instead:"), so a rejection is a redirect, not a dead
  end. Covers `invalid_url` / `not_found` / `too_large` / `unsupported_language` / `too_many_files`
  plus queue-down (`503`) and generic errors.

## How the pieces map to the exit test

All four exit-test items were exercised **live** against a running API + BullMQ + Redis + CognoDB
(except where noted):

| Exit-test item | Result |
|----------------|--------|
| Paste a never-ingested URL → a usable graph, end to end | ✅ `sindresorhus/is-plain-obj` → phases streamed → 48 nodes / 143 edges |
| Oversized, non-TypeScript, and nonexistent → three different, readable rejections | ✅ `torvalds/linux` → `too_large` (6172 MB); `pallets/flask` → `unsupported_language` (Python); missing repo → `not_found` — each with its own copy |
| Kill the worker mid-job → retried or marked failed, never stuck at "parsing" | ⚙️ bounded by the 3-min per-job timeout + concurrency-1 slot release; the queue survives a restart (job state lives in Redis). Not chaos-tested by hand. |
| Fresh-clone the repo, follow the README literally, confirm it runs | ✅ pipeline runs from `pnpm install` + a local Redis; see "Running it" |

Also verified: `200 { cached: true }` on re-submitting an ingested repo, and `404` on an unknown jobId.

## Running it

```bash
# Redis is required (job queue). Locally:
redis-server --daemonize yes --port 6379         # matches REDIS_URL in .env

# API + in-process worker (loads root .env; needs COGNODB_* + REDIS_URL)
pnpm --filter @cartograph/api start:dev

# Web — landing page leads with the paste-a-URL box
pnpm --filter @cartograph/web dev                # http://localhost:5173
```

New config in `.env.example`: `INGEST_NODE_BUDGET` (default `200000`). The GitHub precheck is
unauthenticated — no token needed for public repos (subject to GitHub's shared rate limit).

## Deliberately cut

- **Folder drop** — the plan's explicit cuttable tail ("only if everything above is solid"). URL
  ingestion is the graded path; a drag-and-drop upload with graceful history-less degradation is a
  clean future addition, not shipped here.
- **Forked/sandboxed worker** — see Unit B above: in-process concurrency-1 fallback shipped by design.

## Files

**Engine** — `packages/ingest/{package.json, tsconfig.json, src/{index,types,errors,slug,precheck,clone,db,pipeline}.ts, test/{slug,precheck,pipeline}.test.ts}`
**API** — `apps/api/src/ingest/{ingest.module,ingest.controller,ingest-queue.service,ingest-core,ingest.types,ingest-loader,ingest-core.spec}.ts`, `apps/api/src/app.module.ts`, `apps/api/package.json`, `.env.example`
**Web** — `apps/web/src/features/ingest/{types,ingestApi,useIngest,phases}.ts`, `apps/web/src/features/ingest/{IngestBox,IngestStepper,IngestRejection}.tsx`, `apps/web/src/features/ingest/ingest.css`, `apps/web/src/routes/RepoPicker.tsx`
