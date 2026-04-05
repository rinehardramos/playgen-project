#!/bin/sh
# Install PlayGen Task Daemon as a macOS LaunchAgent
# Usage: sh tools/task-daemon/deploy/macos/install.sh [--uninstall]
set -e

PLIST_NAME="com.playgen.task-daemon"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
LOG_DIR="$HOME/.playgen/logs"
PLIST_DEST="$LAUNCH_AGENTS/$PLIST_NAME.plist"

# ── Uninstall ─────────────────────────────────────────────────────────────────
if [ "${1}" = "--uninstall" ]; then
    echo "Stopping and unloading $PLIST_NAME..."
    launchctl unload "$PLIST_DEST" 2>/dev/null || true
    rm -f "$PLIST_DEST"
    echo "Uninstalled. To stop state files: rm -rf $HOME/.playgen"
    exit 0
fi

# ── Guards ────────────────────────────────────────────────────────────────────
if [ ! -f "$HOME/.playgen.env" ]; then
    echo "ERROR: $HOME/.playgen.env not found."
    echo "  cp $PROJECT_DIR/tools/task-daemon/deploy/playgen.env.example $HOME/.playgen.env"
    echo "  then edit it with your credentials."
    exit 1
fi

command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 not found"; exit 1; }

# ── Ensure only this daemon variant is running ────────────────────────────────
# 1. Unload FIRST so LaunchAgent stops auto-restarting on process death
launchctl unload "$PLIST_DEST" 2>/dev/null || true
sleep 1
# 2. Now kill any lingering process (safe — LaunchAgent won't restart it)
pkill -f 'tools/task-daemon/daemon.py' 2>/dev/null || true
sleep 1

# Stop any container versions (Docker Desktop may use a non-standard CLI path)
DOCKER_BIN=$(command -v docker 2>/dev/null || echo "/Applications/Docker.app/Contents/Resources/bin/docker")
if [ -f "$DOCKER_BIN" ]; then
    for svc in playgen-task-daemon playgen-tg-agent; do
        if "$DOCKER_BIN" inspect "$svc" --format='{{.State.Running}}' 2>/dev/null | grep -q true; then
            echo "Stopping Docker container: $svc"
            "$DOCKER_BIN" stop "$svc" 2>/dev/null || true
        fi
    done
fi

# ── Create directories ────────────────────────────────────────────────────────
mkdir -p "$LAUNCH_AGENTS" "$LOG_DIR" "$HOME/.playgen/state"

# ── Install plist ─────────────────────────────────────────────────────────────
chmod +x "$SCRIPT_DIR/run-daemon.sh"

sed \
    -e "s|INSTALL_PATH|$PROJECT_DIR|g" \
    -e "s|HOMEDIR|$HOME|g" \
    -e "s|USERNAME|$(whoami)|g" \
    "$SCRIPT_DIR/com.playgen.task-daemon.plist" \
    > "$PLIST_DEST"

echo "Installed plist to $PLIST_DEST"

# Load fresh (already unloaded at top of script)
launchctl load -w "$PLIST_DEST"

echo ""
echo "PlayGen Task Daemon installed as macOS LaunchAgent."
echo "  Status : launchctl list | grep playgen"
echo "  Logs   : tail -f $LOG_DIR/daemon.log"
echo "  Stop   : launchctl unload $PLIST_DEST"
echo "  Remove : sh $SCRIPT_DIR/install.sh --uninstall"
