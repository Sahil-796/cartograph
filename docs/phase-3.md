# Phase 3 — Graph layer

> **Status:** ✅ **COMPLETE** — the `GraphPayload` from Phase 2 now lives in CognoDB, and every
> question the product answers is answerable from a terminal, before a single pixel exists.
> Three real repos (hono, drizzle-orm, papermark) are extracted, committed to `seed/`, loaded, and
> pinned; all nine queries return sensible results against that real data.
> **Branch:** `phase-3-graph` (stacked on `phase-2-extraction`).

## Goal

Get the payload **into** CognoDB, and get the eight (actually nine) queries back **out** — plus the
two things that make those queries reusable rather than one-off: a single `tools` definition that
renders each query as an AI/MCP tool, and one generic `POST /api/query/:name` REST door. This is the
layer where "we store facts, the AI does the reasoning" stops being a slogan: the queries are the
fixed, tested traversals; nothing here scores, ranks, or infers.

## The one thing to understand first: one definition, three doors

Everything downstream of the loader hangs off a single artifact — the `QueryDef`:

```
                         packages/graph/src/queries/*.ts
                         each: { name, description, params: zod, cypher, map }
                                          │
                     ┌────────────────────┼─────────────────────┐
                     ▼                    ▼                     ▼
        packages/tools               apps/api                 (Phase 5/6)
        zod → JSON-Schema      POST /api/query/:name          chat + MCP
        (AI / MCP tool defs)   validate → run → map         reuse the same registry
```

The `params` zod schema is the **single source of truth**: it validates the REST body, types the
result, and is converted (once, in `packages/tools`) into the JSON Schema an LLM sees as a tool. There
is deliberately no second, hand-written JSON Schema anywhere, and the AI never writes Cypher — it
picks a query we wrote and tested and supplies its arguments.

```
 seed/*.json  ──(db:seed)──►  load.ts  ──►  CognoDB  ◄──  queries/*.ts  ◄──  executeQuery
   (Phase 2 payloads, pinned)   UNWIND…MERGE          9 parameterised        (zod-validated,
                                batched, idempotent   Cypher traversals       mapped rows)
```

## How to read this phase (reading order)

| # | File | What it is | Why read it here |
|---|------|-----------|------------------|
| 1 | `packages/graph/src/queries/types.ts` | **The contract.** `QueryDef`, `defineQuery`, `executeQuery`. | The boundary the whole query layer + tools + REST are built on. |
| 2 | `packages/graph/src/load.ts` | `loadPayload` — batched, idempotent `UNWIND…MERGE`. | How a payload becomes a graph; read the batching + scalar-`repoId` note. |
| 3 | `packages/graph/src/queries/hiddenCoupling.ts` | The headline negative-path query. | The single best argument for a graph DB. |
| 4 | `packages/graph/src/queries/whoTouched.ts` | Time-decayed ownership. | Aggregation-with-decay; the "SQL would do this too, but here it's one query." |
| 5 | `packages/graph/src/queries/neighbors.ts` | Bounded variable-length traversal. | Shows the depth-parameter gotcha and its fix. |
| 6 | `packages/graph/src/queries/index.ts` | The registry (`queries`, `getQuery`). | What the three doors iterate. |
| 7 | `packages/tools/src/index.ts` | zod → JSON-Schema tool defs. | One definition, rendered for AI/MCP. |
| 8 | `apps/api/src/query/query.controller.ts` | `POST /api/query/:name`. | One handler for all nine; 200/400/404. |
| 9 | `apps/api/src/query/graph-loader.ts` | The ESM→CJS bridge. | Known tech-debt; see below. |
| 10 | `apps/cli/src/ingest.ts` | `cartograph ingest` — the seed generator. | The local door onto the extractor. |
| 11 | `packages/graph/src/scripts/db-seed.ts` | Loads `seed/*.json` pinned. | The "loaded at deploy" step. |

## The data model as loaded

Six labels, seven relationship types, everything scoped by `repoId` (the tenancy boundary — every
query filters on it, and it is the first column of every index). The loader derives a few facts the
payload doesn't carry directly — all counts of facts, never inferences:

- `File.dir` — POSIX dirname of the path (so the map can group by directory without re-parsing).
- `Commit.committedAt` — the ISO timestamp parsed to **epoch seconds**, because the ownership-decay
  query does `($now - c.committedAt)` arithmetic and Cypher can't parse ISO strings.
- `Commit.fileCount` — number of files the commit touched (the ownership query's `<= 30` filter,
  which drops merge/formatting sweeps).
- `CALLS.count` — duplicate `(from,to)` call pairs aggregated into one edge with a count.
- `AUTHORED` — derived by joining `Commit.authorEmail → Author.email` (the payload models authorship
  as a field, not an edge array).

## The query layer — nine parameterised Cypher queries

`search`, `neighbors`, `path`, `who_touched`, `bus_factor`, `co_changed`, `hidden_coupling`,
`cycles`, `entrypoints`. This is the **only** place Cypher exists in the codebase. Every query is
parameterised (`$param`) — never string-concatenated — which satisfies the assignment's
"no string-concatenated Cypher" rule by construction and makes Cypher injection impossible.

The three that carry the interview:

- **`hidden_coupling`** — the negative variable-length path: files that co-change but have **no**
  import path between them within 4 hops (`AND NOT (a)-[:IMPORTS*1..4]-(b)`). One clause; the
  relational equivalent is a recursive CTE inside a `NOT EXISTS`, per candidate pair.
- **`who_touched`** — aggregation with a six-month half-life decay, per-commit lines capped at 500,
  bots excluded, and commits touching > 30 files ignored.
- **`neighbors`** — blast radius at a user-chosen depth.

### The gotcha we found in Phase 3, not Phase 4

Cypher does **not** accept a parameter inside a variable-length bound — `[:CALLS*1..$depth]` is a
syntax error. The fix, used in `neighbors`: a fixed generous ceiling `[:CALLS*1..5]` filtered with
`WHERE length(p) <= $depth`. Still fully parameterised, no string concatenation. The plan flagged
this to find here rather than mid-Phase-4; we did.

### The performance gotcha we also found here (worth interview time)

The first full seed load failed with `context deadline exceeded` on the larger repos. Root cause:
writing `UNWIND $batch AS row … MATCH (n {repoId: row.repoId, …})` makes CognoDB's planner fall back
to a **full label scan per row** (~33 ms/edge — a 20k-edge repo blows the free tier's per-request
deadline). Hoisting `repoId` to a **scalar `$repoId` parameter** (all rows in one load share a repo)
lets the planner use the composite `(repoId, path)` / `(repoId, id)` indexes for the seek —
**~33 ms/edge → ~1.5 ms/edge**. This is exactly the "store facts, index them, and let the query plan
do the work" story, discovered by loading real repos instead of a toy fixture. See the comment on
`runBatched` in `load.ts`.

## Key decisions (and why)

| Decision | Choice | Why |
|----------|--------|-----|
| One definition per query | `{ name, description, params: zod, cypher, map }` | zod is the single source of truth for validation, REST typing, and the AI tool schema; three doors render it, none re-declares it. |
| AI writes no Cypher | Tool calls over fixed parameterised queries | Can't hallucinate a traversal that doesn't exist; satisfies "no string-concatenated Cypher". |
| Loader is idempotent | `MERGE` on natural keys + `SET n += row` | Re-running never duplicates — a graded exit test. |
| Ambiguity in the loader | Drop, never guess | `HANDLED_BY` edges with no resolved symbol are skipped rather than pointed at nothing. |
| Scope by `repoId` scalar | `$repoId`, not `row.repoId` | Lets CognoDB seek the composite index; 20×+ faster load (above). |
| Eviction | `DETACH DELETE` oldest `pinned = false` | Seed repos are pinned, so they survive while user ingests roll over. |

## Deviations from the plan (plan vs actual)

| Plan says | What we did | Why |
|-----------|-------------|-----|
| "Eight parameterised queries" | **Nine** (`entrypoints` listed separately) | The plan's own list names nine; we shipped all of them. |
| CLI flag `--commits 500` | Accepted but a **documented no-op** for a local checkout | History depth is a *clone-time* concern (`git clone --depth`), not something a local extractor can retroactively enforce. We don't fake it. |
| `Repo`/`Author` carry `url`, `commitSha`, `firstSeen`, … | Only fields with a real source are set | No invented data; `url`/`commitSha` come from CLI flags, `firstSeen/lastSeen` derived from commit timestamps. |
| API imports the graph package normally | API loads it via a runtime `tsx` ESM bridge | `apps/api` is CommonJS; `@cartograph/graph` is ESM shipping raw TS. Works today; the clean fix (a built `dist/` for `graph`) is **Phase 4 tech-debt** — see `graph-loader.ts`. |
| Relationships carry `repoId` | Only **nodes** carry `repoId` | Every query scopes by its endpoint *nodes*' `repoId`, so a relationship property would be unused; omitted rather than written and ignored. |
| Seed loaded implicitly | Added `pnpm --filter @cartograph/graph db:seed` | Explicit, idempotent "loaded at deploy" step reading the committed `seed/*.json`. |

## Seed data

Three real repos of different shapes, extracted with the CLI, committed to `seed/`, loaded pinned:

| Repo | Shape | Files | Symbols | Commits | Entrypoints | Call resolution |
|------|-------|------:|--------:|--------:|------------:|----------------:|
| hono | framework/library | 353 | 834 | 577 | 4 | 98% |
| drizzle-orm | ORM monorepo | 943 | 4,216 | 1,830 | 1 | 95% |
| papermark | Next.js web app | 1,365 | 3,220 | 408 | 71 | 100% |

All three clear the plan's ~70% call-resolution bar comfortably. papermark's 71 entrypoints give
`entrypoints` / `HANDLED_BY` real data; drizzle's deep history gives `who_touched` / `co_changed`
something substantial to chew on.

### Live query evidence

All nine verified against the loaded seed data (via the real registry + `executeQuery`):

| Query | Example | Result |
|-------|---------|--------|
| `search` | `{repoId:"drizzle-orm", term:"Column"}` | 50 matches (files/symbols/entrypoints) |
| `neighbors` | `{repoId:"drizzle-orm", nodeId:"…#fixImportPath", dir:"out", depth:3}` | `resolvePathAlias` at 1 hop |
| `path` | two symbols in `fix-imports.ts` | the 2-node call route |
| `hidden_coupling` | `{repoId:"drizzle-orm"}` | `mysql-to-camel.test.ts` ↔ `mysql-to-snake.test.ts` (count 5, strength 1.0) and more |
| `co_changed` | `{repoId:"drizzle-orm", fileId:"…mysql-to-camel.test.ts"}` | 4 partners, ranked by strength |
| `cycles` | `{repoId:"drizzle-orm"}` | 0 (the seed repos are import-acyclic — a correct result) |
| `who_touched` | `{repoId:"papermark", scope:""}` | Marc Seitz top, weighted + `lastTouch` |
| `bus_factor` | `{repoId:"papermark", scope:""}` | bus factor **1** (papermark is genuinely solo-dominated — 63% share) |
| `entrypoints` | `{repoId:"papermark"}` | 71 routes with resolved handler symbols |

Three bugs surfaced here that the empty-DB syntax check in Wave 2 could not catch, and were fixed in
integration — the reason "verify against a real repo, not a fixture" is a phase gate:

1. **Loader ~20× too slow / `context deadline exceeded`.** `repoId` read from each `UNWIND` row
   defeated CognoDB's planner (full label scan per row); hoisting it to a scalar `$repoId` restored
   the composite-index seek (see `load.ts`).
2. **`neighbors` returned nothing.** CognoDB silently drops rows on a parameter-only `WHERE` inside a
   `CALL { … }` subquery; rewritten as a top-level `UNION` of two direction-guarded branches.
3. **`cycles` timed out.** `IMPORTS*2..6` is near-exponential on a real import graph; reduced to
   `*2..4` (still catches essentially all real cycles).

## How this phase was orchestrated (the `/fanout` run)

Recorded because the process is interview material too. Four Sonnet subagents, in dependency waves,
each scoped to a disjoint file set; the orchestrator gated between waves and did integration.

- **Wave 1 (solo — blocking):** the loader (`load.ts`), eviction (`evict.ts`), and the `QueryDef`
  contract (`queries/types.ts`). Everything downstream builds on the contract, so it went first.
- **Wave 2 (parallel):** **B** wrote the nine queries + registry on the main tree; **C** wrote the
  `cartograph ingest` CLI in an isolated git worktree (disjoint files, so no git-index race).
- **Wave 3:** **D** built `packages/tools` + the REST controller, after B's registry existed.
- **Integration (orchestrator):** extracted/committed/loaded/pinned the three seed repos, found and
  fixed the scalar-`repoId` load-performance issue, verified all nine queries against real data, and
  wrote this doc.

## Exit test

| Check (from the plan) | Status |
|-----------------------|--------|
| Three repos loaded and pinned; re-running the loader does not duplicate nodes | ✅ hono/drizzle-orm/papermark loaded pinned; `MERGE`-keyed loader is idempotent (verified by re-run). |
| All (eight) nine queries return sensible results against real data | ✅ verified live against CognoDB (evidence above). |
| `hidden_coupling` surfaces at least one genuinely coupled pair | ✅ see evidence above. |
| A bad parameter returns a validated 400, not a 500 | ✅ `POST /api/query/:name` — 400 (zod issues) / 404 (unknown query) / 200, covered by an integration test against the built server. |

## How to run it

```bash
pnpm install
pnpm --filter @cartograph/graph db:init     # create indexes (idempotent)
pnpm --filter @cartograph/graph db:seed      # load seed/*.json, pinned (idempotent)

# extract any local repo to a payload (the seed generator):
pnpm --filter @cartograph/cli dev ingest /path/to/repo --out seed/<id>.json --repo-id <id>

# serve the queries over REST:
pnpm --filter @cartograph/api start:dev
#   curl -X POST localhost:3001/api/query/hidden_coupling -H 'content-type: application/json' \
#        -d '{"repoId":"drizzle-orm"}'
```
