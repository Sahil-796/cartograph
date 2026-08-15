# Cartograph

A codebase and its git history loaded into a graph database, then queried by AI over fixed tools.

## Stack

Node · pnpm · React/Vite · NestJS · CognoDB Bolt

## Status

Phase 3 — graph layer (`packages/graph` load + 9 queries, `packages/tools`, `apps/cli`, `POST /api/query/:name`; three seed repos loaded and pinned). See [docs/phase-3.md](docs/phase-3.md).

Previous: Phase 2 — extraction (`packages/extract`: repo → `GraphPayload`). See [docs/phase-2.md](docs/phase-2.md).
