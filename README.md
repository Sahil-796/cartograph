# Cartograph

A codebase and its git history loaded into a graph database, then queried by AI over fixed tools.

## Stack

Node · pnpm · React/Vite · NestJS · CognoDB Bolt

## Status

Phase 5 — AI surfaces (`apps/mcp`: stdio MCP server over the 13 tools for Claude Code; chat: `POST /api/chat` runs a Groq `gpt-oss` tool-use loop and answers with citations that highlight the referenced nodes on the map). Both surfaces are thin adapters over the same query registry — no new graph reasoning. Chat needs a valid `GROQ_API_KEY`; MCP uses the connecting agent's own model. See [docs/phase-5.md](docs/phase-5.md).

Previous: Phase 4 — web application (`apps/web`: Vite + React SPA — repo picker, cytoscape/fcose map with five colour modes + focus/depth, evidence side panel, people view, ⌘K search; 4 new whole-repo queries take the registry to 13). See [docs/phase-4.md](docs/phase-4.md).

Earlier: Phase 3 — graph layer (`packages/graph` load + 9 queries, `packages/tools`, `apps/cli`, `POST /api/query/:name`; three seed repos loaded and pinned). See [docs/phase-3.md](docs/phase-3.md).
