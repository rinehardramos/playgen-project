#!/usr/bin/env bash
set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:?GATEWAY_URL must be set}"
FRONTEND_URL="${FRONTEND_URL:-}"

FAILED=0

check() {
  local name="$1"
  local url="$2"
  local status
  status=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
  if [ "$status" = "200" ]; then
    echo "[PASS] $name -> $status"
  else
    echo "[FAIL] $name -> $status"
    FAILED=1
  fi
}

echo "=== Gateway Health ==="
check "gateway" "${GATEWAY_URL}/health"

echo ""
echo "=== Per-Service Health (via gateway proxy) ==="
for svc in auth station library scheduler playlist analytics dj; do
  check "$svc" "${GATEWAY_URL}/health/${svc}"
done

if [ -n "$FRONTEND_URL" ]; then
  echo ""
  echo "=== Frontend Health ==="
  check "frontend" "$FRONTEND_URL"
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "All smoke tests passed."
else
  echo "Some smoke tests FAILED."
fi

exit $FAILED
