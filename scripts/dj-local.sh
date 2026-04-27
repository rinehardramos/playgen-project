#!/usr/bin/env bash
# dj-local.sh
#
# Run the DJ worker directly on the host so it can use the local `claude` CLI
# (LLM_BACKEND=claude-code) with your Claude Code subscription.
#
# This stops the Docker DJ container and starts the worker on the host,
# connecting to the Dockerised Postgres and Redis via their host-mapped ports.
#
# Usage:
#   ./scripts/dj-local.sh          # start local DJ worker
#   ./scripts/dj-local.sh --stop   # stop local DJ worker and restart Docker container

set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if [ "${1:-}" = "--stop" ]; then
  echo "▸ Stopping local DJ worker…"
  pkill -f "dj-service" 2>/dev/null || true
  echo "▸ Restarting Docker DJ container…"
  docker compose up -d dj
  echo "  ✓ Docker DJ container running"
  exit 0
fi

# ── Load base .env ────────────────────────────────────────────────────────────
if [ -f .env ]; then
  set -o allexport
  source .env
  set +o allexport
fi

# ── Override connection URLs to use host-mapped ports ─────────────────────────
export DATABASE_URL="postgresql://${POSTGRES_USER:-playgen}:${POSTGRES_PASSWORD:-changeme}@localhost:${POSTGRES_HOST_PORT:-5432}/${POSTGRES_DB:-playgen}"
export REDIS_URL="redis://localhost:${REDIS_HOST_PORT:-6379}"

# ── LLM: use claude-code backend (local subscription) ────────────────────────
export LLM_BACKEND="claude-code"
unset CLAUDE_RELAY_URL  # direct subprocess — no relay needed on host

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   PlayGen DJ Worker (local — claude-code backend)        ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo "  DATABASE_URL : postgresql://...@localhost:${POSTGRES_HOST_PORT:-5432}/${POSTGRES_DB:-playgen}"
echo "  REDIS_URL    : redis://localhost:${REDIS_HOST_PORT:-6379}"
echo "  LLM_BACKEND  : claude-code (subscription)"
echo ""

# ── Stop Docker DJ container so it doesn't compete for BullMQ jobs ───────────
echo "▸ Stopping Docker DJ container…"
docker compose stop dj 2>/dev/null || true
echo "  ✓ Docker DJ stopped"
echo ""

# ── Start DJ worker on host ───────────────────────────────────────────────────
echo "▸ Starting DJ worker on host…"
echo "  (Ctrl+C to stop; run './scripts/dj-local.sh --stop' to restore Docker)"
echo ""

exec pnpm --filter @playgen/dj-service dev
