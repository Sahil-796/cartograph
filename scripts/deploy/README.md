# Deploy runbook

> **Live API (Azure Container Apps):**
> `https://cartograph-api.greenocean-3c22b32a.centralindia.azurecontainerapps.io`
> — resource group `cartograph-rg`, region Central India, reusing the existing
> `managedEnvironment-seeqlrg-8517` environment. Verified: `/health` → ok,
> `/api/query/search` round-trips to CognoDB. Web (Vercel) URL: _pending login_.


Cartograph deploys as two pieces:

| Piece      | Where                  | What                                        |
| ---------- | ---------------------- | ------------------------------------------- |
| `apps/web` | **Vercel** (static)    | Vite SPA. `VITE_API_URL` baked in at build. |
| `apps/api` | **Azure Container Apps** | NestJS in the repo `Dockerfile` (git + tsx). |

External managed services are already provisioned and live in the repo-root
`.env`: **CognoDB** (`bolt+s://…`) and **Redis Cloud** (`redis://…`, powers the
BullMQ ingest queue). Nothing to stand up — the deploy just carries those
credentials across.

## Prerequisites

```bash
az login                              # Azure CLI, subscription selected
az extension add -n containerapp      # one-time
npm i -g vercel                       # or: bun add -g vercel
```

## 1. API → Azure Container Apps

First deploy builds the image in the cloud from the `Dockerfile` and creates
the resource group, Container Apps environment, and an auto-created ACR:

```bash
az containerapp up \
  --name cartograph-api \
  --resource-group cartograph-rg \
  --location southeastasia \
  --environment cartograph-env \
  --source . \
  --target-port 3001 \
  --ingress external
```

> Region note: this student subscription allows only **1 Container Apps
> environment per region**, and Central India is already taken by another
> project. Southeast Asia (Singapore) is the fallback — low latency to the
> Mumbai-hosted Redis/CognoDB. If its slot is also taken, pick any free region.

Then push the runtime env from `.env` (stores secrets as Container App secrets):

```bash
./scripts/deploy/set-azure-env.sh
```

Note the printed FQDN, e.g. `https://cartograph-api.<hash>.centralindia.azurecontainerapps.io`.
Confirm it is up: `curl https://<fqdn>/health` → `{"status":"ok",…}`.

Re-deploy the API after code changes: re-run the same `az containerapp up`
command (rebuilds + ships a new revision). Env-only change: re-run
`set-azure-env.sh`.

## 2. Web → Vercel

From the repo root (`vercel.json` here pins the pnpm-workspace build):

```bash
vercel link                                   # first time: create/link project
vercel env add VITE_API_URL production        # paste the API FQDN from step 1
vercel --prod                                  # build + deploy
```

`vercel.json` builds only `@cartograph/web`, serves `apps/web/dist`, and
rewrites all non-`/api` paths to `index.html` for the React Router SPA.

## 3. Lock down CORS (after step 2 gives you the Vercel URL)

Until this runs, the API allows all origins (see `apps/api/src/main.ts`).
Restrict it to the deployed frontend:

```bash
./scripts/deploy/set-azure-env.sh https://<your-project>.vercel.app
```

## Environment reference

Fail-fast at API boot (`@cartograph/config`): `COGNODB_URI`, `COGNODB_USER`,
`COGNODB_PASSWORD`, `REDIS_URL`, `GROQ_API_KEY`. The chat loop also uses
`GROQ_MODEL`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`. `CORS_ORIGIN` is
optional (comma-separated origins; unset = allow all). `PORT` (3001) and
`NODE_ENV` are set by the Dockerfile / deploy.
