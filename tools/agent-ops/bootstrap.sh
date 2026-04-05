#!/usr/bin/env bash
# bootstrap.sh — One-command setup for agent-ops in a new project
#
# Usage:
#   bash tools/agent-ops/bootstrap.sh [OPTIONS]
#
# Options:
#   --project NAME           Project name (e.g. MyApp)
#   --repo OWNER/REPO        GitHub repo (e.g. acme/myapp)
#   --telegram-token TOKEN   Telegram bot token
#   --telegram-chat CHAT_ID  Telegram chat ID (negative for groups)
#   --workdir PATH           Working directory inside containers (default: /workspace)
#   --board-number N         GitHub Project board number (default: 1)
#   --board-owner OWNER      GitHub Projects owner (default: repo owner)
#   --no-docker              Skip Docker build and start
#   --help-board-ids         Print GitHub Projects board_id and field IDs, then exit
#   --help                   Show this help
#
# What it does:
#   1. Copies workflow templates to .github/workflows/
#   2. Copies CLAUDE.md, agent-collab.md, lessons.md if not present
#   3. Copies project-health.sh and simulate-deploy.sh to scripts/
#   4. Generates project.config.json from args + interactive prompts
#   5. Builds docker images and starts daemon + tg-agent
#   6. Prints a summary
#   9. Creates tasks/TODO.md stub with phase structure

set -euo pipefail

# ── Script location ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────
PROJECT_NAME=""
REPO=""
TG_TOKEN=""
TG_CHAT=""
WORKDIR="/workspace"
BOARD_NUMBER="1"
BOARD_OWNER=""
NO_DOCKER=0

# ── Argument parsing ──────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "$1" in
        --project)        PROJECT_NAME="$2"; shift 2 ;;
        --repo)           REPO="$2"; shift 2 ;;
        --telegram-token) TG_TOKEN="$2"; shift 2 ;;
        --telegram-chat)  TG_CHAT="$2"; shift 2 ;;
        --workdir)        WORKDIR="$2"; shift 2 ;;
        --board-number)   BOARD_NUMBER="$2"; shift 2 ;;
        --board-owner)    BOARD_OWNER="$2"; shift 2 ;;
        --no-docker)      NO_DOCKER=1; shift ;;
        --help-board-ids)
            _HBI_OWNER="${REPO%%/*}"
            if [ -z "$_HBI_OWNER" ]; then
                _HBI_OWNER="$(git remote get-url origin 2>/dev/null | sed 's|.*github\.com[:/]\([^/]*\)/.*|\1|')"
            fi
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "  GitHub Projects IDs${_HBI_OWNER:+ for: $_HBI_OWNER}"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            echo "  Projects list:"
            gh project list --owner "${_HBI_OWNER:-@me}" --format json \
                --jq '.projects[] | "  #\(.number)  id=\(.id)  \(.title)"' 2>/dev/null \
                || gh project list --owner "${_HBI_OWNER:-@me}" 2>/dev/null \
                || echo "  (run: gh project list --owner <your-org-or-user>)"
            echo ""
            echo "  To list field IDs for board N (replace N with board number above):"
            echo "  gh project field-list N --owner ${_HBI_OWNER:-<owner>} --format json \\"
            echo "    --jq '.fields[] | \"  \\(.id)  \\(.name)\"'"
            echo ""
            echo "  Copy board_id, status_field_id, and option IDs into project.config.json"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            exit 0
            ;;
        --help|-h)
            sed -n '/^# bootstrap/,/^[^#]/p' "$0" | head -35
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✅${NC} $*"; }
warn() { echo -e "  ${YELLOW}⚠️ ${NC} $*"; }
info() { echo -e "  ${CYAN}→${NC}  $*"; }
err()  { echo -e "  ${RED}❌${NC} $*"; }

# ── Interactive prompts ───────────────────────────────────────────────────────
prompt_if_empty() {
    local varname="$1"
    local prompt_text="$2"
    local default="${3:-}"
    local current="${!varname}"
    if [ -z "$current" ]; then
        if [ -n "$default" ]; then
            read -r -p "  $prompt_text [$default]: " val
            val="${val:-$default}"
        else
            read -r -p "  $prompt_text: " val
        fi
        eval "$varname=\"$val\""
    fi
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Agent-Ops Bootstrap"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Project root: $PROJECT_ROOT"
echo ""

# Collect required values
prompt_if_empty PROJECT_NAME "Project name (e.g. MyApp)"
prompt_if_empty REPO         "GitHub repo (e.g. owner/repo)"
prompt_if_empty TG_TOKEN     "Telegram bot token"
prompt_if_empty TG_CHAT      "Telegram chat ID"

# Derive defaults
if [ -z "$BOARD_OWNER" ]; then
    BOARD_OWNER="${REPO%%/*}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Project:  $PROJECT_NAME"
echo "  Repo:     $REPO"
echo "  TG Chat:  $TG_CHAT"
echo "  Workdir:  $WORKDIR"
echo "  Board:    #$BOARD_NUMBER (owner: $BOARD_OWNER)"
echo ""

cd "$PROJECT_ROOT"

# ── Step 1: GitHub workflows ──────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  [1/8] Installing GitHub workflows"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

mkdir -p .github/workflows

if [ -f ".github/workflows/ci.yml" ]; then
    warn ".github/workflows/ci.yml already exists — skipping (back up and re-run to replace)"
else
    cp "$SCRIPT_DIR/workflows/ci.yml" ".github/workflows/ci.yml"
    ok "Copied ci.yml → .github/workflows/ci.yml"
fi

if [ -f ".github/workflows/cd.yml" ]; then
    warn ".github/workflows/cd.yml already exists — skipping"
else
    cp "$SCRIPT_DIR/workflows/cd.yml" ".github/workflows/cd.yml"
    ok "Copied cd.yml → .github/workflows/cd.yml"
fi

# ── Step 2: CLAUDE.md ─────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  [2/8] Installing CLAUDE.md"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f "CLAUDE.md" ]; then
    warn "CLAUDE.md already exists — skipping"
else
    sed "s/{{PROJECT_NAME}}/$PROJECT_NAME/g" \
        "$SCRIPT_DIR/templates/CLAUDE.md" > "CLAUDE.md"
    ok "Created CLAUDE.md"
fi

# ── Step 3: tasks/ templates ──────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  [3/8] Installing task templates"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

mkdir -p tasks

if [ -f "tasks/agent-collab.md" ]; then
    warn "tasks/agent-collab.md already exists — skipping"
else
    cp "$SCRIPT_DIR/templates/agent-collab.md" "tasks/agent-collab.md"
    ok "Created tasks/agent-collab.md"
fi

if [ -f "tasks/lessons.md" ]; then
    warn "tasks/lessons.md already exists — skipping"
else
    cp "$SCRIPT_DIR/templates/lessons.md" "tasks/lessons.md"
    ok "Created tasks/lessons.md"
fi

if [ -f "tasks/TODO.md" ]; then
    warn "tasks/TODO.md already exists — skipping"
else
    cat > "tasks/TODO.md" <<'TODOEOF'
# TODO

## Phase 1: Setup
- [ ] Configure environment variables
- [ ] Set up database and run migrations
- [ ] Verify local dev server starts

## Phase 2: Core Features
- [ ] Implement primary feature set
- [ ] Write unit tests

## Phase 3: Integration & Polish
- [ ] End-to-end integration tests
- [ ] UI/UX review and fixes
- [ ] Performance and security review

## Phase 4: Deployment
- [ ] Staging deploy and smoke test
- [ ] Production deploy
TODOEOF
    ok "Created tasks/TODO.md"
fi

# ── Step 4: scripts/ ──────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  [4/8] Installing scripts"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

mkdir -p scripts

if [ -f "scripts/project-health.sh" ]; then
    warn "scripts/project-health.sh already exists — skipping"
else
    cp "$SCRIPT_DIR/scripts/project-health.sh" "scripts/project-health.sh"
    chmod +x "scripts/project-health.sh"
    ok "Created scripts/project-health.sh"
fi

if [ -f "scripts/simulate-deploy.sh" ]; then
    warn "scripts/simulate-deploy.sh already exists — skipping"
else
    cp "$SCRIPT_DIR/scripts/simulate-deploy.sh" "scripts/simulate-deploy.sh"
    chmod +x "scripts/simulate-deploy.sh"
    ok "Created scripts/simulate-deploy.sh"
fi

# ── Step 5: project.config.json ───────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  [5/8] Generating project.config.json"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

CONFIG_OUT="$SCRIPT_DIR/project.config.json"

if [ -f "$CONFIG_OUT" ]; then
    warn "project.config.json already exists — skipping generation"
    info "Edit $CONFIG_OUT to customize pool, board IDs, tech commands."
else
    python3 - <<PYEOF
import json, os

config = {
    "project": {
        "name": "${PROJECT_NAME}",
        "repo": "${REPO}",
        "workdir": "${WORKDIR}",
        "board_number": int("${BOARD_NUMBER}"),
        "board_owner": "${BOARD_OWNER}",
        "board_id": "PVT_xxx",
        "status_field_id": "PVTSSF_xxx",
        "board_columns": {
            "backlog":     "backlog_option_id",
            "todo":        "todo_option_id",
            "in_progress": "in_progress_option_id",
            "review":      "review_option_id",
            "done":        "done_option_id"
        }
    },
    "pool": {
        "pm-0": {
            "type": "pm", "always": True,
            "desc": "Project manager (board sync, coordination, prioritization)"
        },
        "ticket-bug-0": {
            "type": "ticket-bug", "always": True,
            "desc": "Bugfix worker #1 (priority)"
        },
        "ticket-bug-1": {
            "type": "ticket-bug", "always": False,
            "desc": "Bugfix worker #2 (when bugs exist)"
        },
        "ticket-feat-0": {
            "type": "ticket-feat", "always": False,
            "desc": "Feature worker (lower priority)"
        },
        "merge-0": {
            "type": "merge", "always": True,
            "desc": "PR/Merge checker"
        },
        "health-0": {
            "type": "health", "always": True,
            "desc": "Health check"
        }
    },
    "reset_hours": [0, 5, 9, 14, 19],
    "timezone_offset_hours": 8,
    "tech": {
        "package_manager": "pnpm",
        "test_command": "pnpm run test:unit",
        "build_command": "pnpm run build",
        "lint_command": "pnpm run lint",
        "typecheck_command": "pnpm run typecheck",
        "health_script": "bash scripts/project-health.sh",
        "collab_file": "tasks/agent-collab.md",
        "docker_services": []
    },
    "deploy": {
        "vercel": False,
        "railway": False,
        "frontend_dir": "frontend",
        "vercel_org_id_secret": "VERCEL_ORG_ID",
        "vercel_project_id_secret": "VERCEL_PROJECT_ID",
        "vercel_token_secret": "VERCEL_TOKEN",
        "railway_token_secret": "RAILWAY_TOKEN",
        "db_url_secret": "DATABASE_URL"
    },
    "telegram": {
        "bot_token_env": "TELEGRAM_BOT_TOKEN",
        "chat_id_env": "TELEGRAM_CHAT_ID"
    }
}

out = "${CONFIG_OUT}"
with open(out, "w") as f:
    json.dump(config, f, indent=2)
print(f"  Written: {out}")
PYEOF
    ok "Created project.config.json"
    info "Edit board_id, status_field_id, board_columns with real GitHub Projects IDs"
    info "Edit tech.docker_services with your service names"
fi

# ── Step 6: .env file ─────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  [6/8] Creating .env file"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

ENV_FILE="$SCRIPT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    warn ".env already exists — skipping"
else
    cat > "$ENV_FILE" <<ENVEOF
# Agent-Ops environment variables
# Generated by bootstrap.sh

TELEGRAM_BOT_TOKEN=${TG_TOKEN}
TELEGRAM_CHAT_ID=${TG_CHAT}
GH_TOKEN=
WORKDIR=${WORKDIR}

# Optional: path to claude CLI binary inside container
# CLAUDE_BIN=/usr/local/bin/claude
# CLAUDE_FLAGS=--dangerously-skip-permissions
ENVEOF
    ok "Created .env — add GH_TOKEN before starting Docker services"
fi

# ── Step 7: .gitignore ────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  [7/8] Updating .gitignore"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

GITIGNORE="$PROJECT_ROOT/.gitignore"
ENTRIES=(
    "tools/agent-ops/.env"
    "tools/agent-ops/project.config.json"
)

for entry in "${ENTRIES[@]}"; do
    if [ -f "$GITIGNORE" ] && grep -qF "$entry" "$GITIGNORE"; then
        info "Already in .gitignore: $entry"
    else
        echo "$entry" >> "$GITIGNORE"
        ok "Added to .gitignore: $entry"
    fi
done

# ── Step 8: Docker build + start ──────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  [8/8] Starting Docker services"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$NO_DOCKER" -eq 1 ]; then
    warn "Skipping Docker (--no-docker)"
elif ! command -v docker >/dev/null 2>&1; then
    warn "Docker not found — skipping auto-start"
    info "Install Docker and run manually:"
    info "  cd $SCRIPT_DIR/daemon && docker-compose --env-file ../.env up -d --build"
    info "  cd $SCRIPT_DIR/tg-agent && docker-compose --env-file ../.env up -d --build"
else
    info "Building and starting daemon..."
    (cd "$SCRIPT_DIR/daemon" && docker-compose --env-file "../.env" up -d --build 2>&1) \
        && ok "Daemon started" \
        || err "Daemon failed to start — check logs: docker logs agent-ops-daemon"

    info "Building and starting tg-agent..."
    (cd "$SCRIPT_DIR/tg-agent" && docker-compose --env-file "../.env" up -d --build 2>&1) \
        && ok "Telegram bot started" \
        || err "tg-agent failed to start — check logs: docker logs agent-ops-tg-agent"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Bootstrap Complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  What was set up:"
echo "  ✅ .github/workflows/ci.yml + cd.yml"
echo "  ✅ CLAUDE.md (project instructions)"
echo "  ✅ tasks/agent-collab.md (coordination lock)"
echo "  ✅ tasks/lessons.md (self-improvement log)"
echo "  ✅ tasks/TODO.md (phase structure stub)"
echo "  ✅ scripts/project-health.sh"
echo "  ✅ scripts/simulate-deploy.sh"
echo "  ✅ tools/agent-ops/project.config.json"
echo "  ✅ tools/agent-ops/.env"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Edit tools/agent-ops/project.config.json:"
echo "     - Run: bash tools/agent-ops/bootstrap.sh --help-board-ids --repo $REPO"
echo "       to print your GitHub Projects board_id and field IDs"
echo "     - Set board_id, status_field_id, board_columns from that output"
echo "     - Set tech.docker_services (your service names)"
echo "     - Set deploy.vercel/railway flags"
echo ""
echo "  2. Edit tools/agent-ops/.env:"
echo "     - Add GH_TOKEN (GitHub PAT with repo + project scopes)"
echo "     - Set CLAUDE_BIN if you want auto-spawning"
echo ""
echo "  3. Edit .github/workflows/ci.yml and cd.yml:"
echo "     - Replace the Docker matrix entries with your actual services"
echo "     - Adjust package manager commands if not using pnpm"
echo ""
echo "  4. Customize CLAUDE.md with your project structure and tech stack"
echo ""
echo "  5. Commit everything:"
echo "     git add .github/ CLAUDE.md tasks/ scripts/"
echo "     git commit -m 'chore: add agent-ops framework'"
echo ""
if [ "$NO_DOCKER" -eq 0 ] && command -v docker >/dev/null 2>&1; then
    echo "  Daemon logs:  docker logs -f agent-ops-daemon-1"
    echo "  Bot logs:     docker logs -f agent-ops-tg-agent-1"
fi
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
