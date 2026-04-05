#!/bin/sh
# PlayGen Task Daemon — Linux native runner
# Invoked by systemd user service playgen-task-daemon.service
# systemd's Restart=always ensures only one instance runs.

export PATH="/usr/local/bin:/usr/bin:/bin:/home/$(whoami)/.local/bin"

# ── Load user env ─────────────────────────────────────────────────────────────
ENV_FILE="$HOME/.playgen.env"
if [ -f "$ENV_FILE" ]; then
    set -a; . "$ENV_FILE"; set +a
else
    echo "[playgen-daemon] ERROR: $ENV_FILE not found." >&2
    echo "  Copy tools/task-daemon/deploy/playgen.env.example -> $ENV_FILE and fill values." >&2
    exit 1
fi

# ── Dynamic claude binary discovery ──────────────────────────────────────────
# Linux claude-code-vm location (mirrors macOS but under ~/.config)
CLAUDE_VM_DIR="$HOME/.config/Claude/claude-code-vm"
if [ ! -d "$CLAUDE_VM_DIR" ]; then
    # WSL: try Windows-side AppData mount
    WIN_HOME=$(wslpath "$(cmd.exe /C "echo %USERPROFILE%" 2>/dev/null | tr -d '\r')" 2>/dev/null || true)
    if [ -n "$WIN_HOME" ]; then
        CLAUDE_VM_DIR="$WIN_HOME/AppData/Local/Programs/Claude/claude-code-vm"
    fi
fi

if [ -d "$CLAUDE_VM_DIR" ]; then
    LATEST=$(ls "$CLAUDE_VM_DIR" 2>/dev/null | sort -V | tail -1)
    if [ -n "$LATEST" ]; then
        export CLAUDE_BIN="$CLAUDE_VM_DIR/$LATEST/claude"
    fi
fi
if [ -z "$CLAUDE_BIN" ] || [ ! -f "$CLAUDE_BIN" ]; then
    export CLAUDE_BIN=$(command -v claude 2>/dev/null || true)
fi
if [ -z "$CLAUDE_BIN" ]; then
    echo "[playgen-daemon] WARNING: claude not found — agents queued until installed." >&2
fi

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
export WORKDIR="${WORKDIR:-$PROJECT_DIR}"
export PLAYGEN_STATE_DIR="${PLAYGEN_STATE_DIR:-$HOME/.playgen/state}"
mkdir -p "$PLAYGEN_STATE_DIR"

export CLAUDE_FLAGS="${CLAUDE_FLAGS:---dangerously-skip-permissions}"

echo "[playgen-daemon] platform=linux project=$PROJECT_DIR state=$PLAYGEN_STATE_DIR"
exec python3 "$PROJECT_DIR/tools/task-daemon/daemon.py"
