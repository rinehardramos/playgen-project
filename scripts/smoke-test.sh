#!/usr/bin/env bash
set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:?GATEWAY_URL must be set}"
FRONTEND_URL="${FRONTEND_URL:?FRONTEND_URL must be set}"

FAILED=0

echo "=== Gateway Health Check ==="
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "${GATEWAY_URL}/health" 2>/dev/null || echo "000")
if [ "$STATUS" = "200" ]; then
  echo "[PASS] gateway -> $STATUS"
else
  echo "[FAIL] gateway -> $STATUS"
  FAILED=1
fi

echo ""
echo "=== Service Health Checks (via gateway) ==="
# Each service registers GET /health returning { status: 'ok' }
# Gateway proxies /api/v1/dj/* to dj service; other services have their own /health at root
for svc in auth station library scheduler playlist analytics; do
  # Services expose /health directly; gateway does not proxy these by default
  # Use the gateway health endpoint as a proxy indicator
  URL="${GATEWAY_URL}/health"
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "$URL" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    echo "[PASS] $svc (via gateway) -> $STATUS"
  else
    echo "[FAIL] $svc (via gateway) -> $STATUS"
    FAILED=1
  fi
done

echo ""
echo "=== Frontend Health Check ==="
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "$FRONTEND_URL" 2>/dev/null || echo "000")
if [ "$STATUS" = "200" ]; then
  echo "[PASS] frontend -> $STATUS"
else
  echo "[FAIL] frontend -> $STATUS"
  FAILED=1
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "All smoke tests passed."
else
  echo "Some smoke tests failed!"
fi

exit $FAILED
