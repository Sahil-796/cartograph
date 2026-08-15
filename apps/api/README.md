# @cartograph/api

The Cartograph HTTP API, built with NestJS. This is the Phase 1 skeleton: a
bootable app with a single `/health` endpoint and no database/queue wiring.

Later, the BullMQ-based ingestion worker (forked processor) will run inside
this same deploy alongside the HTTP server.

## Run

```bash
pnpm install
pnpm --filter @cartograph/api start:dev   # watch mode
pnpm --filter @cartograph/api start        # run built dist/main.js (after build)
pnpm --filter @cartograph/api build
pnpm --filter @cartograph/api typecheck
```

The server listens on `process.env.PORT`, defaulting to `3001`.

## Routes

- `GET /health` → `200 { status: "ok", uptime: <seconds>, timestamp: <ISO string> }`.
  No database call — safe to use as a container liveness/readiness probe.

## TypeScript config

This app does **not** extend the workspace's `tsconfig.base.json`. The base
config targets `NodeNext`/ESM (matching `@cartograph/config` and
`@cartograph/graph`, which are ESM source), but NestJS's default tooling
(`@nestjs/cli`, `ts-node`, decorator metadata emission) is most friction-free
under CommonJS. `apps/api/tsconfig.json` sets its own `module: "CommonJS"`,
`experimentalDecorators`, and `emitDecoratorMetadata` instead of inheriting
the base ESM settings.

**Deliberately not wired up in Phase 1:** this app does not import
`@cartograph/config` or `@cartograph/graph`. Those packages are ESM source;
NestJS here defaults to CommonJS. Importing them today would require solving
ESM/CJS interop (e.g. dynamic `import()`, `moduleResolution: "NodeNext"`
with dual builds, or migrating this app to ESM). That's left as a later-phase
concern once the ingestion worker and DB wiring actually need those packages.

## Azure Container Apps deploy notes

- Single container image (see the root `Dockerfile`), built from repo root
  so the whole pnpm workspace is available at build time.
- `min replicas = max replicas = 1` — no scale-to-zero. The BullMQ worker
  that will eventually live in this process needs to stay warm.
- The container must listen on `PORT` (Container Apps injects this, or set
  it explicitly in the Container App's ingress config — default `3001` here
  if unset).
- The runtime image installs `git` (see root `Dockerfile` comment) because
  the future ingestion worker shells out to `git clone`/`git log` against
  target repositories. Not used by anything in Phase 1, but required so the
  same image doesn't need to change when the worker lands.
