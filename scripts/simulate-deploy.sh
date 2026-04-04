#!/usr/bin/env bash
# simulate-deploy.sh — Run local deployment simulation before pushing to main
# Catches Vercel and Docker build issues before they reach production CD
# Usage: bash scripts/simulate-deploy.sh [--vercel] [--docker] [--all]

set -euo pipefail

export PATH="/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

PASS=0
FAIL=0
ERRORS=()

green() { echo -e "\033[0;32m✓ $*\033[0m"; }
red()   { echo -e "\033[0;31m✗ $*\033[0m"; }
blue()  { echo -e "\033[0;34m► $*\033[0m"; }

check() {
  local name="$1"; shift
  blue "Checking: $name"
  if "$@" > /tmp/sim-$PASS.log 2>&1; then
    green "$name"
    PASS=$((PASS + 1))
  else
    red "$name"
    ERRORS+=("$name")
    FAIL=$((FAIL + 1))
    echo "  Last 10 lines:"
    tail -10 /tmp/sim-$FAIL.log | sed 's/^/    /'
  fi
}

MODE="${1:---all}"

echo ""
echo "══════════════════════════════════════"
echo "  PlayGen Deploy Simulation"
echo "══════════════════════════════════════"
echo ""

# ── Vercel (Frontend) ─────────────────────────────────────────────────────────
if [[ "$MODE" == "--vercel" || "$MODE" == "--all" ]]; then
  echo "─── Vercel Frontend ───"

  # Simulate Vercel: NODE_ENV=production, pnpm install, next build
  check "Frontend pnpm install (NODE_ENV=production)" \
    bash -c "cd frontend && NODE_ENV=production pnpm install --frozen-lockfile --silent"

  check "Frontend next build" \
    bash -c "cd frontend && pnpm run build"

  # Verify no devDeps required at build time
  check "TypeScript available after production install" \
    bash -c "cd frontend && NODE_ENV=production pnpm install --frozen-lockfile --silent && node -e \"require('typescript')\" 2>/dev/null || npx tsc --version"

  echo ""
fi

# ── Docker (Railway / All Services) ──────────────────────────────────────────
if [[ "$MODE" == "--docker" || "$MODE" == "--all" ]]; then
  echo "─── Docker Builds ───"
  SERVICES=(auth station library scheduler playlist analytics dj)

  for svc in "${SERVICES[@]}"; do
    check "Docker build: $svc" \
      docker build -q \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        -f "services/$svc/Dockerfile" \
        -t "playgen-sim-$svc:latest" \
        .
  done

  check "Docker build: gateway" \
    docker build -q -f gateway/Dockerfile -t playgen-sim-gateway:latest .

  check "Docker build: migrate" \
    docker build -q -f shared/db/Dockerfile -t playgen-sim-migrate:latest .

  echo ""
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo "══════════════════════════════════════"
echo "  Results: ${PASS} passed, ${FAIL} failed"
echo "══════════════════════════════════════"

if [ "${#ERRORS[@]}" -gt 0 ]; then
  echo ""
  red "Failed checks:"
  for err in "${ERRORS[@]}"; do
    echo "  - $err"
  done
  echo ""
  echo "Fix these issues before merging to main."
  exit 1
else
  green "All checks passed — safe to deploy"
  exit 0
fi
