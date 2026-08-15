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
# This is an assignment deployment, so favour a known-working runtime over a
# slimmer second install. The API dynamically loads the raw TypeScript graph
# workspace through tsx, which means the runtime needs the workspace sources
# and their loader dependencies as well as apps/api/dist.
FROM build AS runtime

# git is required at runtime: the ingestion worker (a later phase, running
# as a BullMQ forked processor inside this same apps/api deploy) shells out
# to `git clone` / `git log` against target repositories. node:20-slim does
# NOT include git by default, so it must be installed explicitly here.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

ENV PORT=3001
EXPOSE 3001

CMD ["node", "apps/api/dist/main.js"]
