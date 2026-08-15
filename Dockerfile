# syntax=docker/dockerfile:1

#############################################
# Build stage: install workspace deps and build apps/api
#############################################
FROM node:20-slim AS build

# Enable pnpm via corepack (bundled with Node 20).
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /repo

# Copy workspace manifests first for better layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @cartograph/api... build

#############################################
# Runtime stage: slim image with git installed
#############################################
FROM node:20-slim AS runtime

# git is required at runtime: the ingestion worker (a later phase, running
# as a BullMQ forked processor inside this same apps/api deploy) shells out
# to `git clone` / `git log` against target repositories. node:20-slim does
# NOT include git by default, so it must be installed explicitly here.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /repo

ENV NODE_ENV=production

# Copy workspace manifests + lockfile. All workspace package.json files are
# copied (not full source) so the pnpm workspace layout matches the
# lockfile; --filter then installs production deps for just the api app
# and any workspace packages it depends on.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/cli/package.json ./apps/cli/package.json
COPY apps/mcp/package.json ./apps/mcp/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/extract/package.json ./packages/extract/package.json
COPY packages/graph/package.json ./packages/graph/package.json
COPY packages/tools/package.json ./packages/tools/package.json

RUN pnpm install --prod --frozen-lockfile --filter @cartograph/api...

# Copy built output from the build stage.
COPY --from=build /repo/apps/api/dist ./apps/api/dist

ENV PORT=3001
EXPOSE 3001

CMD ["node", "apps/api/dist/main.js"]
