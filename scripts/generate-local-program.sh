#!/usr/bin/env bash
# generate-local-program.sh
#
# Thin wrapper around the Radio Program Factory pipeline API.
# Setup (station/DJ profiles) is done via curl, then a single API call
# triggers the entire pipeline: playlist gen → DJ script → TTS → publish.
#
# Usage:
#   ./scripts/generate-local-program.sh [--station-name "Metro Manila Mix"] \
#       [--slug metro-manila-mix] [--date YYYY-MM-DD] \
#       [--dj-profile-id UUID] [--secondary-dj-profile-id UUID] \
#       [--voice-map '{"Name":"voice_id"}'] \
#       [--sync] [--auto-approve]

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Load .env ─────────────────────────────────────────────────────────────
if [ -f .env ]; then
  set -o allexport
  source .env
  set +o allexport
fi

# ── Defaults ──────────────────────────────────────────────────────────────
GATEWAY="${LOCAL_GATEWAY:-http://localhost}"
EMAIL="${ADMIN_EMAIL:-admin@playgen.local}"
PASSWORD="${ADMIN_PASSWORD:-changeme}"
STATION_NAME="Metro Manila Mix"
PLAYLIST_DATE="${PLAYLIST_DATE:-$(date +%Y-%m-%d)}"
AUTO_APPROVE=false
PUBLISH=false
DJ_PROFILE_ID=""
SECONDARY_DJ_PROFILE_ID=""
VOICE_MAP=""

# ── Parse args ────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --station-name)             STATION_NAME="$2"; shift 2 ;;
    --date)                     PLAYLIST_DATE="$2"; shift 2 ;;
    --dj-profile-id)            DJ_PROFILE_ID="$2"; shift 2 ;;
    --secondary-dj-profile-id)  SECONDARY_DJ_PROFILE_ID="$2"; shift 2 ;;
    --voice-map)                VOICE_MAP="$2"; shift 2 ;;
    --sync)                     PUBLISH=true; shift ;;
    --auto-approve)             AUTO_APPROVE=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────
gw() { curl -sf -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$@"; }

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   PlayGen Radio Program Factory                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo "  Station : $STATION_NAME"
echo "  Date    : $PLAYLIST_DATE"
echo "  Gateway : $GATEWAY"
echo ""

# ── Step 1: Authenticate ──────────────────────────────────────────────────
echo "▸ Authenticating…"
TOKEN=$(curl -sf -X POST "$GATEWAY/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r '.tokens.access_token // .access_token')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "  ✗ Authentication failed. Is the local stack running?"
  exit 1
fi
echo "  ✓ Authenticated"

# ── Step 2: Resolve station ID ────────────────────────────────────────────
echo "▸ Resolving station…"
COMPANY_ID=$(gw "$GATEWAY/api/v1/companies" | jq -r '.[0].id')
STATION_ID=$(gw "$GATEWAY/api/v1/companies/$COMPANY_ID/stations" | \
  jq -r ".[] | select(.name == \"$STATION_NAME\") | .id" 2>/dev/null | head -1 || echo "")

if [ -z "$STATION_ID" ] || [ "$STATION_ID" = "null" ]; then
  echo "  ✗ Station '$STATION_NAME' not found"
  exit 1
fi
echo "  ✓ Station: $STATION_ID"

# ── Step 3: Trigger pipeline ─────────────────────────────────────────────
echo "▸ Triggering pipeline…"

TRIGGER_BODY="{\"date\": \"$PLAYLIST_DATE\", \"auto_approve\": $AUTO_APPROVE, \"publish\": $PUBLISH"
[ -n "$DJ_PROFILE_ID" ] && TRIGGER_BODY="$TRIGGER_BODY, \"dj_profile_id\": \"$DJ_PROFILE_ID\""
[ -n "$SECONDARY_DJ_PROFILE_ID" ] && TRIGGER_BODY="$TRIGGER_BODY, \"secondary_dj_profile_id\": \"$SECONDARY_DJ_PROFILE_ID\""
[ -n "$VOICE_MAP" ] && TRIGGER_BODY="$TRIGGER_BODY, \"voice_map\": $VOICE_MAP"
TRIGGER_BODY="$TRIGGER_BODY}"

TRIGGER_RESP=$(curl -s -X POST "$GATEWAY/api/v1/stations/$STATION_ID/pipeline/trigger" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$TRIGGER_BODY")

RUN_ID=$(echo "$TRIGGER_RESP" | jq -r '.pipeline_run_id // empty' 2>/dev/null || echo "")
if [ -z "$RUN_ID" ]; then
  echo "  ✗ Failed to trigger pipeline"
  echo "  Response: $TRIGGER_RESP"
  exit 1
fi
echo "  ✓ Pipeline triggered: $RUN_ID"

# ── Step 4: Poll until complete ──────────────────────────────────────────
echo ""
TIMEOUT=600
ELAPSED=0
LAST_STAGE=""

while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  RUN=$(curl -sf -H "Authorization: Bearer $TOKEN" \
    "$GATEWAY/api/v1/stations/$STATION_ID/pipeline/runs/$RUN_ID" 2>/dev/null || echo "{}")
  STATUS=$(echo "$RUN" | jq -r '.status // "unknown"')
  STAGE=$(echo "$RUN" | jq -r '.current_stage // "waiting"')

  if [ "$STAGE" != "$LAST_STAGE" ] && [ "$STAGE" != "null" ]; then
    [ -n "$LAST_STAGE" ] && echo "  ✓ $LAST_STAGE done"
    echo "  ▸ $STAGE…"
    LAST_STAGE="$STAGE"
  fi

  case "$STATUS" in
    completed)
      echo "  ✓ $LAST_STAGE done"
      echo ""
      PLAYLIST_ID=$(echo "$RUN" | jq -r '.playlist_id // "?"')
      SCRIPT_ID=$(echo "$RUN" | jq -r '.script_id // "?"')
      echo "╔══════════════════════════════════════════════════════════╗"
      echo "║   Pipeline complete!                                     ║"
      echo "╚══════════════════════════════════════════════════════════╝"
      echo "  Station  : $STATION_NAME"
      echo "  Date     : $PLAYLIST_DATE"
      echo "  Playlist : $PLAYLIST_ID"
      echo "  Script   : $SCRIPT_ID"
      echo "  Run      : $RUN_ID"
      echo ""
      echo "  Local UI : http://localhost:3000/stations/$STATION_ID"
      echo ""
      exit 0
      ;;
    failed)
      ERR=$(echo "$RUN" | jq -r '.error_message // "unknown error"')
      echo ""
      echo "  ✗ Pipeline failed at stage '$STAGE': $ERR"
      exit 1
      ;;
  esac

  sleep 5
  ELAPSED=$((ELAPSED + 5))
done

echo ""
echo "  ✗ Pipeline timed out after ${TIMEOUT}s (status: $STATUS, stage: $STAGE)"
exit 1
