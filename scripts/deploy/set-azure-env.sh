#!/usr/bin/env bash
#
# Pushes the runtime environment from the repo-root .env into the deployed
# Azure Container App. Secrets (passwords, API keys, the Redis URL that embeds
# a password) are stored as Container App *secrets*; the rest are plain env
# vars. Re-running is idempotent — it just creates a new revision.
#
# Usage:  ./scripts/deploy/set-azure-env.sh [CORS_ORIGIN]
#   CORS_ORIGIN (optional): the Vercel origin allowed to call the API, e.g.
#   https://cartograph.vercel.app. Omit to leave CORS open (allow-all).
#
# Requires: az CLI logged in, the containerapp extension, and a repo-root .env.
set -euo pipefail

RG="${RG:-cartograph-rg}"
APP="${APP:-cartograph-api}"
ENV_FILE="${ENV_FILE:-$(cd "$(dirname "$0")/../.." && pwd)/.env}"
CORS_ORIGIN="${1:-}"

[ -f "$ENV_FILE" ] || { echo "No .env at $ENV_FILE" >&2; exit 1; }

# Read a KEY=value from .env, tolerating '=' inside the value. Comments/blank
# lines are ignored by the grep. Fails loudly if a required key is missing.
val() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | head -n1 || true)"
  [ -n "$line" ] || { echo "Missing $key in $ENV_FILE" >&2; exit 1; }
  printf '%s' "${line#${key}=}"
}

COGNODB_URI="$(val COGNODB_URI)"
COGNODB_USER="$(val COGNODB_USER)"
COGNODB_PASSWORD="$(val COGNODB_PASSWORD)"
REDIS_URL="$(val REDIS_URL)"
GROQ_API_KEY="$(val GROQ_API_KEY)"
GROQ_MODEL="$(val GROQ_MODEL)"
LLM_BASE_URL="$(val LLM_BASE_URL)"
LLM_MODEL="$(val LLM_MODEL)"
LLM_API_KEY="$(val LLM_API_KEY)"

echo "→ Storing secrets on $APP ..."
az containerapp secret set -g "$RG" -n "$APP" --only-show-errors --secrets \
  cognodb-password="$COGNODB_PASSWORD" \
  redis-url="$REDIS_URL" \
  groq-api-key="$GROQ_API_KEY" \
  llm-api-key="$LLM_API_KEY" >/dev/null

echo "→ Setting env vars (new revision) ..."
ENV_ARGS=(
  "COGNODB_URI=$COGNODB_URI"
  "COGNODB_USER=$COGNODB_USER"
  "COGNODB_PASSWORD=secretref:cognodb-password"
  "REDIS_URL=secretref:redis-url"
  "GROQ_API_KEY=secretref:groq-api-key"
  "GROQ_MODEL=$GROQ_MODEL"
  "LLM_BASE_URL=$LLM_BASE_URL"
  "LLM_MODEL=$LLM_MODEL"
  "LLM_API_KEY=secretref:llm-api-key"
  "NODE_ENV=production"
)
[ -n "$CORS_ORIGIN" ] && ENV_ARGS+=("CORS_ORIGIN=$CORS_ORIGIN")

az containerapp update -g "$RG" -n "$APP" --only-show-errors \
  --set-env-vars "${ENV_ARGS[@]}" >/dev/null

FQDN="$(az containerapp show -g "$RG" -n "$APP" --query properties.configuration.ingress.fqdn -o tsv)"
echo "✓ Done. API: https://$FQDN"
echo "  Health: https://$FQDN/health"
