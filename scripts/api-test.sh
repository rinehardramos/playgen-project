#!/usr/bin/env bash
# PlayGen API Test Suite
# Tests all production API endpoints via the Railway gateway.
#
# Usage:
#   GATEWAY_URL=https://api.playgen.site bash scripts/api-test.sh
#   GATEWAY_URL=http://localhost:80 bash scripts/api-test.sh   # local docker
#
# Required env vars:
#   GATEWAY_URL  - Base URL of the gateway (no trailing slash)
#   TEST_EMAIL   - Admin email (default: admin@playgen.local)
#   TEST_PASS    - Admin password (default: changeme)
#
# Exit code: 0 if all tests pass, 1 if any fail.
#
# MAINTENANCE: Update this file whenever an API endpoint is added, changed,
# or removed. Each section matches a service. Add new assertions directly
# under the relevant service section.
# ─────────────────────────────────────────────────────────────────────────────

set -uo pipefail

GATEWAY="${GATEWAY_URL:-https://api.playgen.site}"
EMAIL="${TEST_EMAIL:-admin@playgen.local}"
PASS="${TEST_PASS:-changeme}"

PASS_COUNT=0
FAIL_COUNT=0
FAILURES=""

# ── Helpers ───────────────────────────────────────────────────────────────────

pass() { echo "[PASS] $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "[FAIL] $1 — $2"; FAIL_COUNT=$((FAIL_COUNT + 1)); FAILURES+="  • $1: $2\n"; }

# Returns HTTP status code for a request
status() {
  curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$@" 2>/dev/null
  true  # always succeed; curl -w prints "000" on failure already
}

# Returns response body (ignores HTTP status)
body() {
  curl -s --max-time 10 "$@" 2>/dev/null
}

# Assert HTTP status matches expected
assert_status() {
  local label="$1" expected="$2"
  shift 2
  local got
  got=$(status "$@")
  if [ "$got" = "$expected" ]; then
    pass "$label → $got"
  else
    fail "$label" "expected $expected, got $got"
  fi
}

# Assert response body contains a JSON key
assert_json_key() {
  local label="$1" key="$2"
  shift 2
  local resp
  resp=$(body "$@")
  if echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if '$key' in d else 1)" 2>/dev/null; then
    pass "$label (has '$key')"
  else
    fail "$label" "response missing key '$key': ${resp:0:120}"
  fi
}

echo ""
echo "=============================="
echo " PlayGen API Test Suite"
echo " Gateway: $GATEWAY"
echo "=============================="
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 1. Gateway health
# ─────────────────────────────────────────────────────────────────────────────
echo "── Gateway ──────────────────"
assert_status "GET /health" "200" "$GATEWAY/health"

# ─────────────────────────────────────────────────────────────────────────────
# 2. Auth service
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── Auth ─────────────────────"

# Login → get tokens
LOGIN_RESP=$(body -X POST "$GATEWAY/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")

ACCESS_TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['tokens']['access_token'])" 2>/dev/null || echo "")
REFRESH_TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['tokens']['refresh_token'])" 2>/dev/null || echo "")

if [ -n "$ACCESS_TOKEN" ]; then
  pass "POST /api/v1/auth/login → got access_token"
else
  fail "POST /api/v1/auth/login" "no access_token in response: ${LOGIN_RESP:0:120}"
fi

# Auth guard: unauthenticated returns 401 on protected routes
# (auth/me doesn't exist; use companies as the guard test)
assert_status "GET /api/v1/companies (no token) → 401" "401" "$GATEWAY/api/v1/companies"

# ─────────────────────────────────────────────────────────────────────────────
# 3. Station service — Companies
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── Station: Companies ───────"

COMPANIES_RESP=$(body -H "Authorization: Bearer $ACCESS_TOKEN" "$GATEWAY/api/v1/companies")
COMPANY_ID=$(echo "$COMPANIES_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'])" 2>/dev/null || echo "")

if [ -n "$COMPANY_ID" ]; then
  pass "GET /api/v1/companies → got company list"
else
  fail "GET /api/v1/companies" "no companies returned: ${COMPANIES_RESP:0:120}"
fi

if [ -n "$COMPANY_ID" ]; then
  assert_json_key "GET /api/v1/companies/:id" "id" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$GATEWAY/api/v1/companies/$COMPANY_ID"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 4. Station service — Stations (listed under company)
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── Station: Stations ────────"

STATION_ID=""
if [ -n "$COMPANY_ID" ]; then
  STATIONS_RESP=$(body -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$GATEWAY/api/v1/companies/$COMPANY_ID/stations")
  STATION_ID=$(echo "$STATIONS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'])" 2>/dev/null || echo "")
  if [ -n "$STATION_ID" ]; then
    pass "GET /api/v1/companies/:id/stations → got station list"
  else
    fail "GET /api/v1/companies/:id/stations" "no stations: ${STATIONS_RESP:0:120}"
  fi
  assert_status "GET /api/v1/companies/:id/stations (no token) → 401" "401" \
    "$GATEWAY/api/v1/companies/$COMPANY_ID/stations"
fi

if [ -n "$STATION_ID" ]; then
  assert_json_key "GET /api/v1/stations/:id" "id" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$GATEWAY/api/v1/stations/$STATION_ID"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 5. Scheduler service — Station config
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── Scheduler: Config ────────"

if [ -n "$STATION_ID" ]; then
  CONFIG_RESP=$(body -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$GATEWAY/api/v1/stations/$STATION_ID/config")
  if echo "$CONFIG_RESP" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    pass "GET /api/v1/stations/:id/config → valid JSON"
  else
    fail "GET /api/v1/stations/:id/config" "${CONFIG_RESP:0:120}"
  fi
  assert_status "GET /api/v1/stations/:id/config (no token) → 401" "401" \
    "$GATEWAY/api/v1/stations/$STATION_ID/config"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 6. Library service — Songs
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── Library: Songs ───────────"

if [ -n "$STATION_ID" ]; then
  SONGS_RESP=$(body -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$GATEWAY/api/v1/stations/$STATION_ID/songs")
  # Songs endpoint returns {"data": [...]} or a plain list
  SONG_COUNT=$(echo "$SONGS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['data'] if isinstance(d, dict) and 'data' in d else d))" 2>/dev/null || echo "")
  if [ -n "$SONG_COUNT" ]; then
    pass "GET /api/v1/stations/:id/songs → $SONG_COUNT songs"
  else
    fail "GET /api/v1/stations/:id/songs" "${SONGS_RESP:0:120}"
  fi
  assert_status "GET /api/v1/stations/:id/songs (no token) → 401" "401" \
    "$GATEWAY/api/v1/stations/$STATION_ID/songs"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 7. Library service — Categories
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── Library: Categories ──────"

if [ -n "$STATION_ID" ]; then
  CATS_RESP=$(body -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$GATEWAY/api/v1/stations/$STATION_ID/categories")
  if echo "$CATS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); assert isinstance(d, list)" 2>/dev/null; then
    pass "GET /api/v1/stations/:id/categories → valid list"
  else
    fail "GET /api/v1/stations/:id/categories" "${CATS_RESP:0:120}"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 8. Playlist service
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── Playlist ─────────────────"

if [ -n "$STATION_ID" ]; then
  PL_RESP=$(body -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$GATEWAY/api/v1/stations/$STATION_ID/playlists")
  if echo "$PL_RESP" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    pass "GET /api/v1/stations/:id/playlists → valid JSON"
  else
    fail "GET /api/v1/stations/:id/playlists" "${PL_RESP:0:120}"
  fi
  assert_status "GET /api/v1/stations/:id/playlists (no token) → 401" "401" \
    "$GATEWAY/api/v1/stations/$STATION_ID/playlists"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 9. Analytics service
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── Analytics ────────────────"

DASH_RESP=$(body -H "Authorization: Bearer $ACCESS_TOKEN" \
  "$GATEWAY/api/v1/dashboard/stats")
if echo "$DASH_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert isinstance(d.get('active_songs'), int)
assert isinstance(d.get('todays_playlists'), int)
assert isinstance(d.get('pending_approvals'), int)
assert isinstance(d.get('active_stations'), int)
" 2>/dev/null; then
  pass "GET /api/v1/dashboard/stats → valid stats object"
else
  fail "GET /api/v1/dashboard/stats" "${DASH_RESP:0:120}"
fi

if [ -n "$STATION_ID" ]; then
  ANA_RESP=$(body -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$GATEWAY/api/v1/stations/$STATION_ID/analytics/heatmap")
  if echo "$ANA_RESP" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    pass "GET /api/v1/stations/:id/analytics/heatmap → valid JSON"
  else
    fail "GET /api/v1/stations/:id/analytics/heatmap" "${ANA_RESP:0:120}"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 10. DJ service
# NOTE: DJ service must be created and deployed on Railway separately.
# If not deployed, these will fail with 502.
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── DJ Service ───────────────"

DJ_STATUS=$(status -H "Authorization: Bearer $ACCESS_TOKEN" "$GATEWAY/api/v1/dj/profiles")
if [ "$DJ_STATUS" = "502" ] || [ "$DJ_STATUS" = "000" ]; then
  fail "GET /api/v1/dj/profiles" "DJ service not deployed (got $DJ_STATUS). Create 'dj' service on Railway and run CD pipeline."
else
  DJ_PROFILES_RESP=$(body -H "Authorization: Bearer $ACCESS_TOKEN" "$GATEWAY/api/v1/dj/profiles")
  if echo "$DJ_PROFILES_RESP" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    pass "GET /api/v1/dj/profiles → valid JSON"
  else
    fail "GET /api/v1/dj/profiles" "${DJ_PROFILES_RESP:0:120}"
  fi

  assert_status "GET /api/v1/dj/profiles (no token) → 401" "401" "$GATEWAY/api/v1/dj/profiles"

  DJ_TEMPLATES_RESP=$(body -H "Authorization: Bearer $ACCESS_TOKEN" "$GATEWAY/api/v1/dj/script-templates")
  if echo "$DJ_TEMPLATES_RESP" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    pass "GET /api/v1/dj/script-templates → valid JSON"
  else
    fail "GET /api/v1/dj/script-templates" "${DJ_TEMPLATES_RESP:0:120}"
  fi

  DJ_DAYPARTS_RESP=$(body -H "Authorization: Bearer $ACCESS_TOKEN" "$GATEWAY/api/v1/dj/dayparts")
  if echo "$DJ_DAYPARTS_RESP" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    pass "GET /api/v1/dj/dayparts → valid JSON"
  else
    fail "GET /api/v1/dj/dayparts" "${DJ_DAYPARTS_RESP:0:120}"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=============================="
echo " Results: $PASS_COUNT passed, $FAIL_COUNT failed"
echo "=============================="

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo ""
  echo "Failures:"
  printf "$FAILURES"
  exit 1
fi

echo "All tests passed."
exit 0
