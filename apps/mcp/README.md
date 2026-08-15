# `@cartograph/mcp`

The MCP front door onto Cartograph's query registry. A stdio [Model
Context Protocol](https://modelcontextprotocol.io) server that exposes the
exact same tool registry the REST API (`apps/api`) and chat surface use —
generated mechanically from `@cartograph/graph`'s query definitions via
`@cartograph/tools`' `toMcpTools()`. There is no hand-maintained MCP tool
list anywhere in this package; if a query is added to the registry, it
shows up here automatically.

## What it exposes

`tools/list` returns all registered queries (`search`, `neighbors`,
`path`, `who_touched`, `bus_factor`, `co_changed`, `hidden_coupling`,
`cycles`, `entrypoints`, `file_graph`, `file_metrics`, `file_commits`,
`tests_for_file`) with JSON-Schema `inputSchema`s derived from each
query's zod `params`.

`tools/call` looks the tool up by name, validates the arguments against
that same zod schema, and runs it against CognoDB — returning the rows as
JSON. An unknown tool name, a validation failure, or a database error all
come back as a readable MCP tool error (`isError: true`); the process
never crashes.

Every query takes a `repoId`. Three demo repos are seeded in CognoDB:

- `hono`
- `drizzle-orm`
- `papermark`

## Registering with Claude Code

The server is launched with `tsx` (this package's `start` script), run
from the repo root so it can find the root `.env` (`COGNODB_URI`,
`COGNODB_USER`, `COGNODB_PASSWORD`). Register it with:

```
claude mcp add cartograph -- pnpm --filter @cartograph/mcp run start
```

Run that command from the repo root (or pass `--cwd` pointing at the repo
root if your Claude Code invocation's working directory differs) — the
server resolves `.env` relative to its own source file, not the process's
cwd, but `pnpm --filter` itself needs to be run from inside (or above)
the workspace to resolve the `@cartograph/mcp` filter.

Required environment: `COGNODB_URI`, `COGNODB_USER`, `COGNODB_PASSWORD`
must be set in the repo-root `.env` before the server starts — it loads
them itself (mirroring `packages/graph/src/scripts/load-env.ts`), so no
extra `--env` flags are needed on the `claude mcp add` command.

## How to verify (a human needs to do this — Claude Code cannot screenshot itself)

1. Run the `claude mcp add` command above from the repo root.
2. Restart Claude Code (or start a fresh session) so it picks up the new
   MCP server.
3. Ask it something that requires a graph tool call, e.g.:

   > using cartograph, who owns src/router in hono?

   Claude Code should call the `cartograph` MCP server's `who_touched`
   tool with `{ "repoId": "hono", "scope": "src/router" }` and answer
   using the returned rows. A screenshot of that exchange — the tool call
   showing up in Claude Code's UI plus the answer — is the artifact this
   phase needs; take it once step 3 completes successfully.

## Local development

```
pnpm --filter @cartograph/mcp run typecheck
pnpm --filter @cartograph/mcp run start   # speaks MCP over stdio — pipe JSON-RPC in to test manually
```
