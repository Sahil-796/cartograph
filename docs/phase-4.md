# Phase 4 — Web application

> **Status:** ✅ **COMPLETE** — the graph layer from Phase 3 now has a product on top of it. A
> Vite + React SPA (`apps/web`) renders the whole-repo map, colours it five ways, focuses a node to
> its symbol-level neighbourhood, and answers "who owns this?" in evidence sentences — all driven by
> the same `POST /api/query/:name` door, no new bespoke endpoints.
> Three real repos (hono, drizzle-orm, papermark) render end-to-end against live CognoDB.
> **Branch:** `phase-4-web` (stacked on `phase-3-graph`). **Stack:** Vite · React · TypeScript ·
> react-router · cytoscape/fcose · zustand · cmdk.

## Goal

This is the graded phase — "design effort is explicitly part of the evaluation." Everything in
Phase 3 was answerable from a terminal; Phase 4 makes it a thing a person who has never seen the
codebase can pick up and use to find an owner without being told how. The product deliberately adds
**no reasoning** of its own: every screen is a deterministic driver over the fixed query registry.
The web app is the first of the "three doors" (REST/MCP/chat) to actually get built; it consumes the
generic endpoint and never writes Cypher.

## The one thing to understand first: one API door, many queries

The backend still exposes exactly **one** generic endpoint — `POST /api/query/:name` — and that is not
a limitation, it is the design. The 13 queries are separate first-class `QueryDef`s in the
`@cartograph/graph` registry (name + zod params + Cypher + map); the web app is a deterministic
driver, so it names the query in the URL rather than needing 13 routes. Everything the UI knows about
the graph flows through one typed client:

```
   apps/web/src/lib/api.ts        POST /api/query/:name
   runQuery<T>(name, params) ───►  (Phase 3 controller: validate → run → map) ───► rows: T[]
        │                          ApiError { kind: network|server|validation|notFound }
        ▼
   feature hooks (useGraphData, useAsyncData) ──► cached per repo / per node ──► React
```

Phase 5/6 (chat, MCP) will bind the *same* registry as tools an AI picks from. `apps/mcp` is still a
Phase-6 stub — nothing is exposed over MCP yet.

## Four backend queries added for the UI

Phase 3 shipped 9 node-/pair-centric queries; the map and panel needed a few whole-repo shapes, so
the registry grew 9 → 13. These auto-expose through the generic endpoint (no `apps/api` change):

| Query | Params | Feeds | Notes |
|-------|--------|-------|-------|
| `file_graph` | `{ repoId }` | the map structure | all file nodes (`path, ext, loc, isTest, isGenerated`) + aggregated **file→file import edges** `{ fromPath, toPath, weight }`. File granularity only — no symbol edges. |
| `file_metrics` | `{ repoId, halfLifeDays?, now? }` | the five colour modes | per-file `ownerName` (time-decayed, same weighting as `who_touched`/`bus_factor`), `lastCommitAt`, `busFactor`, `coveredByTest`. One call recolours the whole map. |
| `file_commits` | `{ repoId, path, limit? }` | side-panel history | recent commits that CHANGED a file, newest first. |
| `tests_for_file` | `{ repoId, path }` | side-panel tests row | `File{isTest:true}` nodes that directly import the file. |

## The screens

| Route | What it is |
|-------|-----------|
| `/` | Repo picker — cards for the three seed repos; doubles as the empty state. |
| `/r/:repoId` | The map (left) + evidence side panel (right). |
| `/r/:repoId/people` | Repo-wide contributors, ranked, each as an evidence sentence. |

- **The map** — cytoscape.js with the `fcose` layout. Directories are compound nodes, files are sized
  by `loc`, edges are the top-N aggregated file→file imports by weight (capped so it reads as
  structure, not spaghetti). Symbol-level edges never appear in the base map.
- **Colour modes** — owner · recency · bus factor · coverage · directory. One control recolours every
  node live, each mode with its own legend and a colourblind-safe ramp on the amber-on-near-black
  palette.
- **Focus view** — select a node, drag the depth slider 1→5, and the symbol-level neighbourhood
  expands via the `neighbors` query while the rest of the map dims.
- **Side panel** — owners, tests, co-change partners, bus factor, recent commits. Each row is its own
  query, fetched on demand, and the product rule holds throughout: **never a bare score, always an
  evidence sentence** ("58% of recent weighted changes across 19 files, last touched 3 weeks ago").
- **People view** — the same rule at repo scope, plus a bus-factor callout for the whole repo.
- **⌘K search** — a `cmdk` palette over files, symbols, and entrypoints via the `search` query;
  selecting a result focuses the node and opens the panel.
- **States, built with each screen** — skeletons while querying, the picker as the empty state, a
  "can't reach the database" banner with a working retry, and no-results states that suggest what to
  try. The map draws its structure first (grey) and never white-screens when colour metrics fail.

## Design system

Dark-first, tweakcn **"Amber Minimal"** — a single amber accent (`--primary`
`oklch(0.7686 0.1647 70.08)`) on a near-black canvas, Inter / JetBrains Mono, shadcn-style oklch
tokens in `apps/web/src/styles/`. Colour is reserved for the graph's data encoding; the chrome stays
quiet.

## Performance: store it, don't refetch it

The first cut refetched on every navigation and blocked the map on its slowest query. Fixed:

- **Map data is cached per repo** (`features/map/graphCache.ts`) — leaving the map and returning no
  longer refetches `file_graph`/`file_metrics`; the cache also dedupes concurrent/StrictMode mounts.
- **Structure is decoupled from metrics** — the map builds and lays out from `file_graph` alone, then
  joins `file_metrics` into the node data in place (no relayout). A metrics failure degrades to grey
  colours instead of erroring the whole screen.
- **Panel/People results are cached per `(query, repo, node)`** (`features/panel/useAsyncData.ts`) —
  re-selecting a node you've already opened is instant. Graph facts are static within a session, so a
  plain cache (busted by retry) is correct.

## Two bugs worth remembering

- **`.env` never loaded at boot.** `@cartograph/config` validates `process.env` at import time and
  `process.exit(1)`s if a var is missing, but nothing loaded the root `.env` — so `start`/`start:dev`
  failed with a config error unless the vars were already exported. Fixed with a first-import side
  module (`apps/api/src/env.ts`) that loads the monorepo-root `.env` before `AppModule` evaluates.
- **`search` 500'd on every keystroke.** Query params are parsed twice (controller `safeParse`, then
  `executeQuery.parse`); `search`'s `kinds` field used `.optional().transform(v => v ?? null)`, so the
  first parse turned `undefined` into `null` and the second parse rejected that `null` — a `ZodError`
  that escaped as a 500. `.nullish()` makes the schema idempotent. Lesson: a params schema that is
  parsed more than once must be a fixed point of its own transforms.

## Exit test

| Check | Result |
|-------|--------|
| Full click-through on a seed repo, empty console | ✅ hono verified live (map → colour modes → focus/depth → panel evidence → People → ⌘K). |
| Colour modes switch live with legends | ✅ owner/recency verified; ramps colourblind-safe. |
| Node selection → evidence panel, not bare scores | ✅ e.g. "37% of recent weighted changes, last touched 3 months ago". |
| DB failure degrades, not white-screen | ✅ structure renders without metrics; connection failure shows a retry banner. |
| Deployed, README, recording | ⬜ not yet — the remaining Phase-4 shipping items. |

## Known issues / tech debt

- **`file_metrics` deadlines on papermark.** The per-file, per-author time-decayed weighting for the
  whole repo in one transaction exceeds CognoDB's ~20s server-side deadline on the largest seed
  (→ 500). The frontend now survives it (grey colours), but the fix is to **materialize per-file
  metrics at load time** (compute once in `db:seed`, store as `File` properties) so the query becomes
  a property read. This would also remove the 5–10s first-open latency on panel rows.
- **JS bundle > 500 kB** (cytoscape is heavy) — fine for the demo; wants a `manualChunks` split before
  it matters.
- **`apps/mcp` is a stub** — Phase 6.

## How this was built

Phase 4 was fanned out across a small agent fleet: one foundation unit (scaffold, router, typed API
client, shared store, state components, design tokens, stubs), then parallel feature units (map;
side panel + people; ⌘K search) plus a backend-queries unit for the four new `QueryDef`s. Each unit
owned a disjoint slice; the shared store and stub contracts were the seams. The map's author hit a
session limit mid-run, so its work was completed and committed by hand — see the commit history on
`phase-4-web`.
