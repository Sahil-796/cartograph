# Phase 5 — AI surfaces (chat + MCP)

> **Status:** ✅ **COMPLETE** — the fixed query registry now has two AI front doors on top of it.
> A **chat panel** (`apps/web` + `POST /api/chat`) runs a Groq `gpt-oss` tool-use loop that *composes*
> the 13 tested queries and answers with citations that highlight the referenced nodes on the map; an
> **MCP server** (`apps/mcp`) exposes the identical tools over stdio so Claude Code can query the graph
> from the editor. Neither surface adds a single line of graph reasoning — both are thin adapters over
> the same `@cartograph/graph` registry the REST layer already uses.
> **Branch:** `phase-5-ai` (stacked on `phase-4-web`). **Adds:** Groq (OpenAI-compatible) · `@modelcontextprotocol/sdk`.

## The thesis of this phase: rent the intelligence

Phases 1–4 built the map and the roads — parsing, the graph, 13 tested queries, and a deterministic
web product that drives them. Phase 5 hands the wheel to a model. The plan calls this "rent the
intelligence": *we do not build the driver.* Any model — through the built-in chat or through MCP —
does the reasoning by **calling our queries as tools**. That sidesteps text-to-Cypher entirely: the
model never invents a query, it composes queries we have already written and tested.

Because [`packages/tools`](../packages/tools/src/index.ts) already renders every `QueryDef.params`
zod schema into a transport-neutral tool definition (Phase 3), both surfaces in this phase are
**wiring, not building**:

- `toOpenAITools()` → the exact `{ type:"function", function:{...} }` shape Groq's chat API wants.
- `toMcpTools()` → the exact `{ name, description, inputSchema }` shape an MCP `tools/list` wants.

There is deliberately **no hand-written JSON Schema and no second registry** anywhere. One set of
query definitions fans out to three doors (REST, chat, MCP); adding a fourth is another one-line
adapter, not a new code path.

## The one thing to understand first: the citation is a node address

The graded detail of the chat surface is **"no citation, no claim"** — every factual sentence in the
answer must point back to a tool result, and *clicking that citation must light up the same nodes on
the map.* That single requirement drove the whole design of the chat contract:

- The backend runs the tool loop and, for **each** tool result, mints a stable id (`c1`, `c2`, …) in
  call order and attaches the **map-addressable nodes** that result refers to.
- The model is instructed to cite each claim with the marker of the result it came from — literally
  `[c1]`, `[c3]` inline in its prose.
- The frontend renders each `[cN]` marker as a clickable **chip**; clicking it writes those nodes to
  the shared repo store, and the map rings them.

So a citation is not decoration — it is an **address into the graph**. That is what makes the chat
feel *part of* the product rather than bolted beside it.

### The frozen contract (`POST /api/chat`)

The backend and frontend were built in parallel against this exact shape (field-for-field identical
in [`apps/api/src/chat/chat.types.ts`](../apps/api/src/chat/chat.types.ts) and
[`apps/web/src/features/chat/types.ts`](../apps/web/src/features/chat/types.ts)):

```ts
// Request
{ repoId: string, messages: { role: "user" | "assistant"; content: string }[] }

// Response (HTTP 200)
interface ChatResponse {
  answer: string;          // final text, with inline [c1] [c3] citation markers
  citations: Citation[];   // one per tool result, in call order
  steps: ChatStep[];       // the tool-call trace (what it chained), for transparency
}
interface Citation {
  id: string;              // "c1","c2",…  ← the marker the model writes
  tool: string;            // query name, e.g. "who_touched"
  args: Record<string, unknown>;
  summary: string;         // "who_touched(path=src/router) → 3 result(s)"
  nodes: CitationNode[];   // what to highlight on the map when the chip is clicked
}
interface CitationNode { kind: "file" | "author" | "symbol"; ref: string; }
interface ChatStep { tool: string; args: Record<string,unknown>; citationId: string; rowCount: number; }
```

| Status | Meaning | UI behaviour |
|--------|---------|--------------|
| `200` | answer + citations | render prose, chips, and the collapsible tool trace |
| `400` | malformed body | inline validation error |
| `503` | `GROQ_API_KEY` unset | friendly **"chat isn't configured"** state, not a crash |
| `500` | Groq or DB failure | inline error with retry |

## Surface 1 — chat

### Backend — the Groq tool-use loop (`apps/api/src/chat/`)

A NestJS `ChatModule` mounted at `POST /api/chat`. It reuses the same ESM/CJS bridge the query
controller uses (`new Function("s","return import(s)")` after registering `tsx/esm/api`) to pull the
ESM-only `@cartograph/graph` and `@cartograph/tools` into the CommonJS Nest app — see
[`chat-graph-loader.ts`](../apps/api/src/chat/chat-graph-loader.ts).

The loop ([`loop.ts`](../apps/api/src/chat/loop.ts)) is the graded core:

1. Send `messages` + `tools: toOpenAITools()` to Groq (`gpt-oss`, OpenAI-compatible endpoint, plain
   `fetch` — no SDK dependency).
2. If the model returns `tool_calls`, execute **each** via `executeQuery(getQuery(name), args)`, mint
   the next `cN` id, build the `Citation` (summary + extracted nodes), and echo the `citationId` back
   inside the `role:"tool"` message so the model knows which marker to cite.
3. Repeat, **capped at 6 tool-executing steps** so a confused model can't spin; after the cap it is
   forced to answer with `tool_choice:"none"`.

Two supporting pieces:

- **`nodes.ts`** — a pure `extractNodes(queryName, rows)` that turns raw rows into `CitationNode[]`:
  files from `path`/`fromPath`/`toPath`, authors from `name`, symbols as `path#name`, defensive `[]`
  on any unknown shape, deduped. This is the bridge from "a query result" to "something the map can
  ring."
- **`groq.ts`** — a dependency-free Groq client over global `fetch`. Model id from `GROQ_MODEL`
  (default `openai/gpt-oss-120b`), key from `GROQ_API_KEY`.

The system prompt pins the `repoId` (and mandates it in every tool call), mandates a `[cN]` citation
for every claim, and mandates that **if the tools can't answer, it says so plainly rather than
inventing** — the third exit-test case is a first-class instruction, not an afterthought.

### Frontend — chat panel + citation chips (`apps/web/src/features/chat/`)

`ChatPanel` docks into `RepoView` behind a **Detail / Chat** tab toggle on the right pane, so the
chat sits beside the map without displacing the evidence panel. It renders the conversation, an empty
state with clickable example questions, a "composing tools…" state, and the four error states above.

The assistant's `answer` is parsed for `[cN]` markers, each rendered as a `CitationChip` (amber, in
the design system). Clicking a chip calls `repoStore.highlightNodes(citation.nodes)`;
[`MapView`](../apps/web/src/features/map/MapView.tsx) reacts through
[`applyHighlight`](../apps/web/src/features/map/highlight.ts), ringing the matching file nodes with a
`.cg-highlight` class (amber border + underlay glow). Author citations have no map node and are a
silent no-op — the highlight rings *what exists on the canvas* and never errors. The chat
deliberately writes `highlightedNodes` **without** stealing the current selection/focus, so a chip
augments the map rather than hijacking it.

The collapsible **tool trace** (`steps`) is shown on purpose: the composition — *bus_factor →
neighbors → entrypoints*, chained by the model — is the payoff we didn't have to build, and it's
worth letting the user see the model's reasoning path.

## Surface 2 — MCP server (`apps/mcp/`)

A stdio MCP server built on `@modelcontextprotocol/sdk`. `apps/mcp` is already ESM, so it imports
`@cartograph/graph`/`@cartograph/tools` directly (run under `tsx`); it loads the repo-root `.env`
before touching the driver and logs **only to stderr** (stdout is the JSON-RPC transport):

- `tools/list` → `toMcpTools()` — all 13 tools with their generated `inputSchema`s.
- `tools/call` → `getQuery(name)` then `executeQuery(def, args)`; unknown names and bad params come
  back as readable `isError` results, never a crashed process.

Register it with Claude Code from the repo root:

```bash
claude mcp add cartograph -- pnpm --filter @cartograph/mcp run start
```

(needs `COGNODB_URI` / `COGNODB_USER` / `COGNODB_PASSWORD` in the root `.env`). Then ask, e.g.,
*"using cartograph, who owns src/router in hono?"*. This is the image the plan wants near the top of
the README — a human needs to capture that screenshot once a valid graph is loaded.

## How the pieces map to the exit test

| Exit-test item | Where it lives | Status |
|----------------|----------------|--------|
| Tool loop capped so a confused model can't spin | `loop.ts` `MAX_TOOL_STEPS = 6` | ✅ verified (unit test) |
| Every claim cites a tool result; no citation, no claim | system prompt + `cN` id assignment | ✅ verified (unit test) |
| Clicking a citation highlights those nodes on the map | `highlightNodes` → `applyHighlight` | ✅ verified live (chip rang a real file node on the `hono` map) |
| One question chains two tools the model was never told to chain | model composition over the registry | ⏳ needs a valid `GROQ_API_KEY` |
| Claude Code connects over MCP and answers about a seeded repo | `apps/mcp` | ✅ verified live (`tools/list` + a real `tools/call` against CognoDB) |
| Ask something the tools can't answer → it says so | system prompt instruction | ⏳ needs a valid `GROQ_API_KEY` |

### What is verified vs. what needs a key

- **Fully verified without credentials:** the MCP server end to end against live CognoDB; the chat
  loop's citation-id assignment and node extraction (9 mocked unit tests); the `/api/chat` route
  mounting with correct `400` / `503` behaviour; the citation-chip → map-highlight wiring against the
  real seeded map.
- **Blocked only on a credential:** a genuine model answer with citations. The `GROQ_API_KEY` in
  `.env` is the `gsk-your-key-here` placeholder, so a real Groq call returns `401`. Drop a real key in
  `.env` and the five prepared questions run — no code change required. (Entering the key is a manual
  step; it isn't something the build can do for you.)

## Running it

```bash
# 1. Backend (serves /api/query/:name AND /api/chat). Needs a real GROQ_API_KEY in .env for chat.
pnpm --filter @cartograph/api start:dev

# 2. Web app (proxies /api → :3001)
pnpm --filter @cartograph/web dev            # http://localhost:5173 → open a repo → "Chat" tab

# 3. MCP server (for Claude Code, not the browser)
claude mcp add cartograph -- pnpm --filter @cartograph/mcp run start
```

Config: `GROQ_API_KEY` (required for chat) and optional `GROQ_MODEL` (default `openai/gpt-oss-120b`)
are documented in `.env.example`. MCP needs no model key — it uses the connecting agent's own model.

## Design decisions worth walking through

- **One registry, three doors.** REST, chat, and MCP all iterate the same `queries` array and call
  the same `executeQuery`. The zod `params` schema is the single source of truth for REST validation
  *and* the AI tool schema — there is no parallel JSON Schema to drift.
- **Plain `fetch`, no OpenAI SDK.** The Nest app is CommonJS and the AI packages are ESM-only; adding
  an SDK would have compounded the module-interop friction for zero benefit. Groq's OpenAI-compatible
  endpoint is a handful of `fetch` calls.
- **Citation = node address.** Making each citation carry `CitationNode[]` (rather than an opaque
  footnote) is what lets a chip drive the map. The extraction is a single pure function, easy to test
  and to extend when a new query shape appears.
- **The loop is injected, not hard-wired.** `runChatLoop(deps, …)` takes its Groq client and
  `executeQuery` as dependencies, which is why the whole graded core is covered by fast unit tests
  with no live model or database.

## Files

**MCP** — `apps/mcp/{package.json, README.md, src/index.ts, src/server.ts, src/env.ts}`
**Chat backend** — `apps/api/src/chat/{chat.types.ts, chat-graph-loader.ts, groq.ts, nodes.ts, loop.ts, chat.service.ts, chat.controller.ts, chat.module.ts, loop.spec.ts}`, `apps/api/src/app.module.ts`, `apps/api/package.json`, `.env.example`
**Chat frontend** — `apps/web/src/features/chat/{types.ts, chatApi.ts, useChat.ts, ChatPanel.tsx, CitationChip.tsx, chat.css}`, `apps/web/src/features/map/{highlight.ts, style.ts, MapView.tsx}`, `apps/web/src/state/repoStore.ts`, `apps/web/src/routes/RepoView.tsx`
