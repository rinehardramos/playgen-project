#!/bin/sh
# PlayGen Task Daemon — macOS native runner
# Invoked by LaunchAgent com.playgen.task-daemon
# LaunchAgent's KeepAlive=true ensures only one instance runs.

set -e

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# ── Load user env ─────────────────────────────────────────────────────────────
ENV_FILE="$HOME/.playgen.env"
if [ -f "$ENV_FILE" ]; then
    set -a; . "$ENV_FILE"; set +a
else
    echo "[playgen-daemon] ERROR: $ENV_FILE not found." >&2
    echo "  Copy tools/task-daemon/deploy/playgen.env.example -> $ENV_FILE and fill values." >&2
    exit 1
fi

# ── Dynamic claude binary (auto-discovers latest installed version) ────────────
CLAUDE_VM_DIR="$HOME/Library/Application Support/Claude/claude-code-vm"
if [ -d "$CLAUDE_VM_DIR" ]; then
    LATEST=$(ls "$CLAUDE_VM_DIR" 2>/dev/null | sort -V | tail -1)
    if [ -n "$LATEST" ]; then
        export CLAUDE_BIN="$CLAUDE_VM_DIR/$LATEST/claude"
    fi
fi
# Fallback to PATH if vm dir not found
if [ -z "$CLAUDE_BIN" ] || [ ! -f "$CLAUDE_BIN" ]; then
    export CLAUDE_BIN=$(command -v claude 2>/dev/null || true)
fi
if [ -z "$CLAUDE_BIN" ]; then
    echo "[playgen-daemon] WARNING: claude not found — agents queued until claude is installed." >&2
fi

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
export WORKDIR="${WORKDIR:-$PROJECT_DIR}"
export PLAYGEN_STATE_DIR="${PLAYGEN_STATE_DIR:-$HOME/.playgen/state}"
mkdir -p "$PLAYGEN_STATE_DIR"

# Workers need zero user intervention
export CLAUDE_FLAGS="${CLAUDE_FLAGS:---dangerously-skip-permissions}"

echo "[playgen-daemon] platform=macos project=$PROJECT_DIR state=$PLAYGEN_STATE_DIR"
exec python3 "$PROJECT_DIR/tools/task-daemon/daemon.py"
