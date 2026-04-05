#!/usr/bin/env bash
# Deployment Monitor — checks Vercel + Railway service health and alerts via Telegram.
#
# Required env vars:
#   GATEWAY_URL          — public gateway base URL (e.g. https://api.playgen.site)
#   TELEGRAM_BOT_TOKEN   — Telegram bot token
#   TELEGRAM_CHAT_ID     — Telegram chat/group ID
#
# Optional env vars:
#   FRONTEND_URL         — Vercel frontend URL (e.g. https://www.playgen.site)
#   VERCEL_TOKEN         — Vercel API token
#   VERCEL_PROJECT_ID    — Vercel project ID (from vercel project inspect)
#   RAILWAY_TOKEN        — Railway API token (for richer deployment info)
#   ALERT_THRESHOLD      — failures before alerting (default: 1)

set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:?GATEWAY_URL must be set}"
TG_TOKEN="${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN must be set}"
TG_CHAT="${TELEGRAM_CHAT_ID:?TELEGRAM_CHAT_ID must be set}"
FRONTEND_URL="${FRONTEND_URL:-}"
VERCEL_TOKEN="${VERCEL_TOKEN:-}"
VERCEL_PROJECT_ID="${VERCEL_PROJECT_ID:-}"
RAILWAY_TOKEN="${RAILWAY_TOKEN:-}"
TIMEOUT=10

FAILED=0
PASSED=0
ALERTS=()
RESULTS=()

tg_send() {
  local msg="$1"
  curl -s -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\":\"${TG_CHAT}\",\"text\":\"${msg}\"}" > /dev/null 2>&1 || true
}

check_url() {
  local name="$1"
  local url="$2"
  local expected="${3:-200}"
  local status
  status=$(curl -sf -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$url" 2>/dev/null || echo "000")
  if [ "$status" = "$expected" ]; then
    RESULTS+=("[PASS] $name -> $status")
    PASSED=$((PASSED + 1))
  else
    RESULTS+=("[FAIL] $name -> $status (expected $expected)")
    ALERTS+=("$name: HTTP $status")
    FAILED=$((FAILED + 1))
  fi
}

echo "=== Deployment Monitor — $(date '+%Y-%m-%d %H:%M:%S %Z') ==="
echo ""

# ── 1. Gateway health ──────────────────────────────────────────────────────────
echo "--- Gateway ---"
check_url "gateway" "${GATEWAY_URL}/health"

# ── 2. Per-service health via gateway proxy ────────────────────────────────────
echo "--- Services ---"
for svc in auth station library scheduler playlist analytics dj; do
  check_url "$svc" "${GATEWAY_URL}/health/${svc}"
done

# ── 3. Frontend health ─────────────────────────────────────────────────────────
if [ -n "$FRONTEND_URL" ]; then
  echo "--- Frontend ---"
  check_url "frontend" "$FRONTEND_URL" "200"
fi

# ── 4. Vercel latest deployment status ────────────────────────────────────────
if [ -n "$VERCEL_TOKEN" ] && [ -n "$VERCEL_PROJECT_ID" ]; then
  echo "--- Vercel ---"
  DEPLOY_JSON=$(curl -sf \
    -H "Authorization: Bearer ${VERCEL_TOKEN}" \
    "https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/deployments?limit=1&target=production" \
    --max-time 15 2>/dev/null || echo "{}")
  DEPLOY_STATE=$(echo "$DEPLOY_JSON" | python3 -c \
    "import sys,json; d=json.load(sys.stdin).get('deployments',[{}])[0]; print(d.get('state','unknown'))" \
    2>/dev/null || echo "unknown")
  DEPLOY_URL=$(echo "$DEPLOY_JSON" | python3 -c \
    "import sys,json; d=json.load(sys.stdin).get('deployments',[{}])[0]; print(d.get('url',''))" \
    2>/dev/null || echo "")
  if [ "$DEPLOY_STATE" = "READY" ]; then
    RESULTS+=("[PASS] vercel deployment -> READY ($DEPLOY_URL)")
    PASSED=$((PASSED + 1))
  elif [ "$DEPLOY_STATE" = "unknown" ]; then
    RESULTS+=("[WARN] vercel deployment -> could not fetch status")
  else
    RESULTS+=("[FAIL] vercel deployment -> $DEPLOY_STATE ($DEPLOY_URL)")
    ALERTS+=("Vercel deployment: $DEPLOY_STATE")
    FAILED=$((FAILED + 1))
  fi
fi

# ── 5. Print results ───────────────────────────────────────────────────────────
echo ""
for line in "${RESULTS[@]}"; do
  echo "$line"
done
echo ""
echo "Summary: ${PASSED} passed, ${FAILED} failed"

# ── 6. Telegram alert on any failure ──────────────────────────────────────────
if [ "$FAILED" -gt 0 ]; then
  ALERT_BODY=$(printf '%s\n' "${ALERTS[@]}")
  MSG="🚨 DEPLOYMENT ALERT — $(date '+%Y-%m-%d %H:%M')
${ALERT_BODY}
Passed: ${PASSED} | Failed: ${FAILED}
Check: ${GATEWAY_URL}/health"
  echo ""
  echo "Sending Telegram alert..."
  tg_send "$MSG"
  echo "Alert sent."
  exit 1
fi

echo "All checks passed."
exit 0
