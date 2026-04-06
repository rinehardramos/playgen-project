#!/usr/bin/env bash
set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:?GATEWAY_URL must be set}"
FRONTEND_URL="${FRONTEND_URL:-}"
MAX_RETRIES="${MAX_RETRIES:-10}"
RETRY_INTERVAL="${RETRY_INTERVAL:-15}"

FAILED=0

check() {
  local name="$1"
  local url="$2"
  local status
  status=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
  echo "$status"
}

check_with_retry() {
  local name="$1"
  local url="$2"
  local attempt=1
  local status

  while [ $attempt -le "$MAX_RETRIES" ]; do
    status=$(check "$name" "$url")
    if [ "$status" = "200" ]; then
      echo "[PASS] $name -> $status"
      return 0
    fi
    if [ $attempt -lt "$MAX_RETRIES" ]; then
      echo "[RETRY] $name -> $status (attempt $attempt/$MAX_RETRIES, waiting ${RETRY_INTERVAL}s)"
      sleep "$RETRY_INTERVAL"
    else
      echo "[FAIL] $name -> $status (exhausted $MAX_RETRIES attempts)"
    fi
    attempt=$((attempt + 1))
  done
  FAILED=1
}

echo "=== Gateway Health ==="
check_with_retry "gateway" "${GATEWAY_URL}/health"

echo ""
echo "=== Per-Service Health (via gateway proxy) ==="
for svc in auth station library scheduler playlist analytics dj; do
  check_with_retry "$svc" "${GATEWAY_URL}/health/${svc}"
done

if [ -n "$FRONTEND_URL" ]; then
  echo ""
  echo "=== Frontend Health ==="
  check_with_retry "frontend" "$FRONTEND_URL"
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "All smoke tests passed."
else
  echo "Some smoke tests FAILED."
fi

exit $FAILED
