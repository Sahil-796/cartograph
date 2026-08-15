# Cartograph

A codebase and its git history loaded into a graph database, then queried by AI over fixed tools.

## Stack

Node · pnpm · React/Vite · NestJS · CognoDB Bolt

## Status

Phase 4 — web application (`apps/web`: Vite + React SPA — repo picker, cytoscape/fcose map with five colour modes + focus/depth, evidence side panel, people view, ⌘K search; 4 new whole-repo queries take the registry to 13). See [docs/phase-4.md](docs/phase-4.md).

Previous: Phase 3 — graph layer (`packages/graph` load + 9 queries, `packages/tools`, `apps/cli`, `POST /api/query/:name`; three seed repos loaded and pinned). See [docs/phase-3.md](docs/phase-3.md).
