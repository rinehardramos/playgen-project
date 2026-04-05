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

# ── Dynamic claude binary (macOS native — Homebrew Cask install) ─────────────
# NOTE: claude-code-vm/ contains Linux ELF binaries for Docker — do NOT use here.
# The native macOS binary is installed via: brew install --cask claude-code
if [ -z "$CLAUDE_BIN" ] || [ ! -f "$CLAUDE_BIN" ]; then
    # Prefer the symlink managed by Homebrew Cask (auto-updated on upgrade)
    if [ -f "/opt/homebrew/bin/claude" ]; then
        export CLAUDE_BIN="/opt/homebrew/bin/claude"
    fi
fi
if [ -z "$CLAUDE_BIN" ] || [ ! -f "$CLAUDE_BIN" ]; then
    # Fallback: scan Caskroom for latest version
    CASK_DIR="/opt/homebrew/Caskroom/claude-code"
    if [ -d "$CASK_DIR" ]; then
        LATEST=$(ls "$CASK_DIR" 2>/dev/null | sort -V | tail -1)
        if [ -n "$LATEST" ] && [ -f "$CASK_DIR/$LATEST/claude" ]; then
            export CLAUDE_BIN="$CASK_DIR/$LATEST/claude"
        fi
    fi
fi
if [ -z "$CLAUDE_BIN" ] || [ ! -f "$CLAUDE_BIN" ]; then
    export CLAUDE_BIN=$(command -v claude 2>/dev/null || true)
fi
if [ -z "$CLAUDE_BIN" ] || [ ! -f "$CLAUDE_BIN" ]; then
    echo "[playgen-daemon] WARNING: claude not found — install with: brew install --cask claude-code" >&2
    unset CLAUDE_BIN
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
