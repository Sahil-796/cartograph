# Cartograph — known limitations

> A running list of what the system deliberately does *not* do, and why. This is
> honesty-as-documentation: every entry is a scope decision or a known edge, not a
> bug waiting to be hidden. Kept in `docs/` for reference; not pushed.

## Extraction (`packages/extract`)

### Now captured (after the nested-symbol change)
- **Top-level** functions, classes, and `const`/arrow bindings.
- **Nested function declarations** at any depth — e.g. `function runClaimedStep()` defined
  inside `createWorker()` → id `src/worker/worker.ts#createWorker.runClaimedStep`.
- **Class methods** — `method() {}` and function-valued class properties (`handle = () => {}`)
  → id `Class.method`.
- Symbol **ids are qualified** by the enclosing named-scope chain (`Outer.inner`, `Class.method`)
  so nested/method names never collide; the human `name` stays the plain identifier, so
  search still finds a symbol by its simple name.
- Call edges attribute to the **nearest enclosing recorded symbol** (a call inside
  `runClaimedStep` is owned by `createWorker.runClaimedStep`, not the outermost function),
  and resolve two extra unambiguous shapes: a bare call to a lexically-visible nested function,
  and `this.method()` within a class.

### Still NOT captured (deliberate scope)
- **Nested `const`/arrow bindings inside a function body** — local callback helpers like
  `const onTick = () => {…}` declared inside another function. High volume, low addressability;
  they'd bloat the graph with per-closure noise. Named nested *function declarations* are
  captured; nested *const* callables are not.
- **Anonymous functions with no binding** — `export default () => {}`, inline
  `arr.map(x => …)`, IIFEs. No stable name → no stable id, so they're skipped rather than guessed.
- **Destructured bindings** — `const { a, b } = obj` has no single declared name.
- **Interfaces, types, enums, namespaces** — the symbol set is *callable/definable code units*
  (function/class/const/arrow/method), not the type layer.
- **Cross-instance method calls** — `someObj.method()` on an arbitrary receiver is ambiguous
  (which class is `someObj`?) and is never resolved into a call edge. Only `this.method()`,
  bare calls, and namespace-import calls (`ns.foo()`) resolve. A missing edge is acceptable;
  a wrong edge is a bug, so ambiguity is left unresolved by design.
- **Dynamic dispatch** — calls through variables, higher-order returns, `obj[key]()`,
  reflection, `eval` — untraceable statically.

### Language & analysis scope
- **TypeScript / JavaScript only** (`.ts/.tsx/.js/.jsx`). One honest extractor over one language
  family rather than four partial ones. A non-TS/JS repo is rejected at ingest, not half-parsed.
- **No full type resolution.** Import resolution is path/alias-based (tsconfig `paths` honoured),
  not type-checker-driven. Re-exports and barrel files resolve to the *file*, and a callee is
  tied to a symbol only when the name is unambiguous.
- **Call resolution is a reported metric, not 100%.** The payload carries
  `callResolutionRate = callsResolved / callsInScope` and the raw `callsObserved`, precisely so
  the number can't hide how much of a codebase is method/library calls we don't trace. On
  `orqestra` it's ~97%; on method-heavy OO codebases it will be lower — that's the honest signal.

### Heuristics with tuned (not principled) constants
- **Co-change threshold 3, 500-line commit cap, 180-day ownership half-life** — noise floors and
  decay tuned against real repos, shown here rather than presented as universal truths.
- **Entrypoint detection** is convention-based (recognised route/registration patterns), so a
  bespoke framework's routes may not be seen.

## Ingestion (`packages/ingest`, `apps/api`)

- **Guardrails reject before cloning**: repos > 50 MB, non-TS/JS primary language, > 1,500 source
  files, and unparseable/non-GitHub URLs. These are designed rejections, not failures.
- **History depth capped at `--depth 500`** (blobless clone). Commits beyond that are omitted;
  at a 180-day half-life their ownership weight is ~0 anyway, but very old repos lose deep history.
- **Public GitHub only.** Precheck uses the unauthenticated GitHub API (subject to its shared IP
  rate limit); private repos and other hosts aren't supported via URL.
- **Worker is in-process, concurrency 1** (not a forked/sandboxed processor). A heavy ts-morph
  parse briefly shares the API event loop; the 3-minute per-job hard timeout bounds the worst case.
- **Eviction on write** removes the oldest *unpinned* repo once the node budget
  (`INGEST_NODE_BUDGET`, default 200k) is exceeded — so an ingested repo can later disappear from a
  shared demo DB. Seed repos are pinned and never evicted.
- **Folder-drop ingestion is not built** (the plan's explicit cuttable tail).

## AI surfaces (`apps/api/src/chat`, `apps/mcp`)

- **Chat is rate-limited by the Groq free tier** (~8k tokens/min on `on_demand`). Each step
  re-sends all 13 tool schemas plus the growing message history, so multi-tool questions can hit
  `429`. Levers: a higher-TPM model (`GROQ_MODEL`), fewer rows per tool result / fewer tool steps,
  or a paid tier. The graph itself is fully queryable via **MCP with zero LLM tokens** — for
  "does X exist / who owns Y", MCP is the reliable door and chat is a convenience wrapper.
- **Chat only knows what the tools expose.** If a fact isn't in the 13 queries (e.g. a symbol the
  extractor doesn't capture — see above), chat correctly says so rather than inventing. "Can't find
  `runClaimedStep`" was previously a *correct* answer about a symbol that wasn't in the graph.
- **MCP requires a live CognoDB connection** (the connecting agent supplies the model; Cartograph
  supplies only the tools).

## Deployment & product scope

- **API + worker share one Azure Container Apps replica** (`min = max = 1`). The BullMQ ingestion
  worker runs in-process inside `apps/api` (concurrency 1) rather than as a separate, independently
  scalable service; a heavy ts-morph parse briefly shares the API's event loop. Deliberate
  single-container choice for the assignment, not a production topology.
- **No auth layer.** No user accounts, logins, permissions, or per-user tenancy — every visitor
  shares the single CognoDB. Multi-tenant isolation is explicitly out of scope.
- **No secondary SQL/NoSQL stores.** The graph database is the only store of truth. There is no
  application database (users, sessions, billing, audit); no product layer exists that needs one.
  Redis is only the BullMQ broker for ingestion, never a source of truth.

## Storage

- **Single shared CognoDB.** All ingested repos live in one database governed by the node budget;
  there's no per-user isolation. Fine for a demo, not multi-tenant.
