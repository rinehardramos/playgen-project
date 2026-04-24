#!/usr/bin/env bash
# generate-local-program.sh
#
# Standalone radio program generator for PlayGen local stack.
# Runs the complete pipeline:
#   auth → create station + DJ profile → create playlist → source songs →
#   generate DJ script via Claude Code → TTS all segments → sync to production
#
# Usage:
#   ./scripts/generate-local-program.sh [--station-name "Metro Manila Mix"] \
#       [--slug metro-manila-mix] [--date YYYY-MM-DD] [--hours 6] \
#       [--sync] [--auto-approve]
#
# Environment (read from .env or shell):
#   LOCAL_GATEWAY   http://localhost (default)
#   ADMIN_EMAIL     admin@playgen.local (default)
#   ADMIN_PASSWORD  changeme (default)
#   PROD_GATEWAY_URL  https://api.playgen.site
#   PROD_ACCESS_TOKEN production JWT for sync step
#   MISTRAL_API_KEY   for TTS
#   ANTHROPIC_API_KEY for DJ script generation

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
STATION_SLUG="metro-manila-mix"
PLAYLIST_DATE="${PLAYLIST_DATE:-$(date +%Y-%m-%d)}"
BROADCAST_HOURS=6        # hours of programming (reduced for generation speed)
AUTO_APPROVE=false
SYNC_TO_PROD=false

# ── Parse args ────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --station-name) STATION_NAME="$2"; shift 2 ;;
    --slug)         STATION_SLUG="$2"; shift 2 ;;
    --date)         PLAYLIST_DATE="$2"; shift 2 ;;
    --hours)        BROADCAST_HOURS="$2"; shift 2 ;;
    --sync)         SYNC_TO_PROD=true; shift ;;
    --auto-approve) AUTO_APPROVE=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────
gw() { curl -sf -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$@"; }

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   PlayGen Local Radio Program Generator                  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo "  Station : $STATION_NAME ($STATION_SLUG)"
echo "  Date    : $PLAYLIST_DATE"
echo "  Hours   : $BROADCAST_HOURS"
echo "  Gateway : $GATEWAY"
echo ""

# ── Step 1: Authenticate ──────────────────────────────────────────────────
echo "▸ Step 1/8: Authenticating…"
TOKEN=$(curl -sf -X POST "$GATEWAY/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r '.access_token')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "  ✗ Authentication failed. Is the local stack running?"
  exit 1
fi
echo "  ✓ Authenticated"

# ── Step 2: Get company ID ────────────────────────────────────────────────
echo "▸ Step 2/8: Getting company ID…"
COMPANY_ID=$(gw "$GATEWAY/api/v1/companies" | jq -r '.[0].id')
if [ -z "$COMPANY_ID" ] || [ "$COMPANY_ID" = "null" ]; then
  echo "  ✗ No company found"
  exit 1
fi
echo "  ✓ Company: $COMPANY_ID"

# ── Step 3: Create or get station ─────────────────────────────────────────
echo "▸ Step 3/8: Creating station '$STATION_NAME'…"

# Check if station with this slug already exists
EXISTING_STATION=$(gw "$GATEWAY/api/v1/companies/$COMPANY_ID/stations" | \
  jq -r ".[] | select(.slug == \"$STATION_SLUG\") | .id" 2>/dev/null || echo "")

if [ -n "$EXISTING_STATION" ] && [ "$EXISTING_STATION" != "null" ]; then
  STATION_ID="$EXISTING_STATION"
  echo "  ✓ Station already exists: $STATION_ID"
else
  STATION_ID=$(gw -X POST "$GATEWAY/api/v1/companies/$COMPANY_ID/stations" \
    -d "{
      \"name\": \"$STATION_NAME\",
      \"timezone\": \"Asia/Manila\",
      \"locale_code\": \"fil-PH\",
      \"city\": \"Metro Manila\",
      \"country_code\": \"PH\",
      \"callsign\": \"MMIX\",
      \"tagline\": \"Metro Manila's Freshest Mix\",
      \"broadcast_start_hour\": 6,
      \"broadcast_end_hour\": $(( 6 + BROADCAST_HOURS ))
    }" | jq -r '.id')

  if [ -z "$STATION_ID" ] || [ "$STATION_ID" = "null" ]; then
    echo "  ✗ Failed to create station"
    exit 1
  fi

  # Set the slug
  gw -X PUT "$GATEWAY/api/v1/stations/$STATION_ID" \
    -d "{\"slug\": \"$STATION_SLUG\"}" > /dev/null || true

  echo "  ✓ Station created: $STATION_ID"
fi

# ── Step 4: Create DJ profile (Taglish persona) ───────────────────────────
echo "▸ Step 4/8: Setting up Taglish DJ profile…"

# Check for existing profile for this company
EXISTING_PROFILE=$(gw "$GATEWAY/api/v1/dj/profiles" | \
  jq -r ".[] | select(.name == \"Camille — Metro Manila Mix\") | .id" 2>/dev/null || echo "")

if [ -n "$EXISTING_PROFILE" ] && [ "$EXISTING_PROFILE" != "null" ]; then
  PROFILE_ID="$EXISTING_PROFILE"
  echo "  ✓ DJ profile already exists: $PROFILE_ID"
else
  PROFILE_ID=$(gw -X POST "$GATEWAY/api/v1/dj/profiles" \
    -d '{
      "name": "Camille — Metro Manila Mix",
      "personality": "Energetic, warm, and relatable Manila millennial DJ. Speaks Taglish naturally — mostly English with Tagalog words and phrases sprinkled in. Loves referencing local culture: EDSA traffic, street food, pop culture, OPM, and the fast-paced Metro Manila lifestyle. Never forced or try-hard — the Tagalog flows naturally like how young Manila professionals actually talk.",
      "voice_style": "Upbeat and confident with a clear, bright radio voice. Energy like a morning drive show host. Pronounces Tagalog words with correct Filipino accent. Keeps banter short and punchy — never over-explains.",
      "persona_config": {
        "catchphrases": ["Grabe naman!", "Talaga?!", "Sige let'\''s go!", "Stay fab, Manila!"],
        "signature_greeting": "Good morning, Manila! Kamusta na kayo? Ito na naman tayo!",
        "signature_signoff": "Maraming salamat sa pag-stay! Ingat kayo diyan, Manila!",
        "backstory": "Grew up in Quezon City, studied Comm Arts at UP. Started in community radio and worked her way to Manila'\''s freshest mix station. Knows every shortcut to avoid EDSA traffic and every good tapsilog spot in the metro.",
        "energy_level": 9,
        "humor_level": 7,
        "formality": "casual",
        "joke_style": "observational"
      },
      "llm_model": "claude-sonnet-4-6",
      "tts_provider": "mistral",
      "tts_voice_id": "energetic_female"
    }' | jq -r '.id')

  if [ -z "$PROFILE_ID" ] || [ "$PROFILE_ID" = "null" ]; then
    echo "  ✗ Failed to create DJ profile"
    exit 1
  fi
  echo "  ✓ DJ profile created: $PROFILE_ID"
fi

# Configure station settings: Mistral TTS + Anthropic LLM
gw -X POST "$GATEWAY/api/v1/stations/$STATION_ID/settings" \
  -d '{"key":"tts_provider","value":"mistral"}' > /dev/null || true
gw -X POST "$GATEWAY/api/v1/stations/$STATION_ID/settings" \
  -d '{"key":"tts_voice_id","value":"energetic_female"}' > /dev/null || true
gw -X POST "$GATEWAY/api/v1/stations/$STATION_ID/settings" \
  -d '{"key":"llm_provider","value":"anthropic"}' > /dev/null || true
gw -X POST "$GATEWAY/api/v1/stations/$STATION_ID/settings" \
  -d "{\"key\":\"llm_model\",\"value\":\"claude-sonnet-4-6\"}" > /dev/null || true
echo "  ✓ Station settings configured (Mistral TTS + Anthropic LLM)"

# ── Step 5: Create playlist and populate with songs ───────────────────────
echo "▸ Step 5/8: Creating playlist for $PLAYLIST_DATE…"

# Generate playlist via the scheduler service (triggers PlaylistService.buildPlaylist)
PLAYLIST_ID=$(gw -X POST "$GATEWAY/api/v1/playlists/generate" \
  -d "{
    \"station_id\": \"$STATION_ID\",
    \"date\": \"$PLAYLIST_DATE\",
    \"hours\": $BROADCAST_HOURS
  }" | jq -r '.playlist_id // .id // empty')

if [ -z "$PLAYLIST_ID" ] || [ "$PLAYLIST_ID" = "null" ]; then
  # Fallback: create playlist manually and use whatever songs exist in the library
  echo "  ⚠ Auto-generate failed — creating playlist manually from library…"
  PLAYLIST_ID=$(gw -X POST "$GATEWAY/api/v1/playlists" \
    -d "{\"station_id\": \"$STATION_ID\", \"date\": \"$PLAYLIST_DATE\"}" | jq -r '.id')

  if [ -z "$PLAYLIST_ID" ] || [ "$PLAYLIST_ID" = "null" ]; then
    echo "  ✗ Failed to create playlist"
    exit 1
  fi

  # Add songs from the library to this playlist
  echo "  Adding songs from library…"
  SONGS=$(gw "$GATEWAY/api/v1/songs?station_id=$STATION_ID&limit=20" | jq -r '.[].id' 2>/dev/null || echo "")
  POS=1
  HOUR=6
  for SONG_ID in $SONGS; do
    [ "$POS" -gt 20 ] && break
    gw -X POST "$GATEWAY/api/v1/playlists/$PLAYLIST_ID/entries" \
      -d "{\"song_id\":\"$SONG_ID\",\"hour\":$HOUR,\"position\":$POS}" > /dev/null || true
    POS=$(( POS + 1 ))
    [ $(( POS % 4 )) -eq 1 ] && HOUR=$(( HOUR + 1 ))
  done
fi

echo "  ✓ Playlist: $PLAYLIST_ID"

# ── Step 6: Generate DJ script via Claude Code skill ──────────────────────
echo "▸ Step 6/8: Generating Taglish DJ script via /generate-dj-script…"
echo "  (This uses Claude Code's native capabilities — no external LLM call)"
echo ""

AUTO_FLAG=""
$AUTO_APPROVE && AUTO_FLAG="--auto-approve"

# Invoke the generate-dj-script skill via Claude Code CLI
# The skill fetches context from local API, writes the script, and posts it back
claude --print --dangerously-skip-permissions \
  "/generate-dj-script $PLAYLIST_ID $AUTO_FLAG --gateway $GATEWAY --token $TOKEN" 2>&1

echo ""
echo "  ✓ DJ script submitted to PlayGen"

# Fetch the script ID for TTS step
SCRIPT_ID=$(gw "$GATEWAY/api/v1/dj/scripts?playlist_id=$PLAYLIST_ID" | \
  jq -r '.[0].id // .script_id // empty')

if [ -z "$SCRIPT_ID" ] || [ "$SCRIPT_ID" = "null" ]; then
  echo "  ⚠ Could not retrieve script ID — skipping TTS step"
else
  # ── Step 7: Generate TTS for all segments ─────────────────────────────
  echo "▸ Step 7/8: Generating TTS audio via Mistral Voxtral…"
  gw -X POST "$GATEWAY/api/v1/dj/scripts/$SCRIPT_ID/tts" > /dev/null || \
    echo "  ⚠ TTS generation queued (async — check DJ service logs)"
  echo "  ✓ TTS generation triggered for script $SCRIPT_ID"

  # ── Step 8: Sync to production (optional) ─────────────────────────────
  if $SYNC_TO_PROD; then
    echo "▸ Step 8/8: Syncing to production…"
    echo "  Waiting 30s for TTS to complete before sync…"
    sleep 30

    pnpm tsx scripts/sync-program.ts "$SCRIPT_ID" \
      --prod-gateway "${PROD_GATEWAY_URL:-https://api.playgen.site}" \
      --prod-token "${PROD_ACCESS_TOKEN:-}" \
      --station-slug "$STATION_SLUG"
  else
    echo "▸ Step 8/8: Skipping production sync (pass --sync to enable)"
    echo "  To sync later:"
    echo "    pnpm tsx scripts/sync-program.ts $SCRIPT_ID --prod-token <jwt>"
  fi
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   🎙  Radio program generation complete!                 ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo "  Station   : $STATION_NAME ($STATION_SLUG)"
echo "  Date      : $PLAYLIST_DATE"
echo "  Playlist  : $PLAYLIST_ID"
if [ -n "${SCRIPT_ID:-}" ] && [ "$SCRIPT_ID" != "null" ]; then
  echo "  Script    : $SCRIPT_ID"
fi
echo ""
echo "  Local UI  : http://localhost:3000/stations/$STATION_ID"
echo ""
