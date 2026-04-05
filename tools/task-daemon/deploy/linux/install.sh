#!/bin/sh
# Install PlayGen Task Daemon as a Linux systemd user service
# Works on plain Linux and WSL2 (with systemd enabled)
# Usage: sh tools/task-daemon/deploy/linux/install.sh [--uninstall]
set -e

SERVICE_NAME="playgen-task-daemon"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
SERVICE_DEST="$SYSTEMD_USER_DIR/$SERVICE_NAME.service"

# ── Uninstall ─────────────────────────────────────────────────────────────────
if [ "${1}" = "--uninstall" ]; then
    echo "Stopping and disabling $SERVICE_NAME..."
    systemctl --user stop  "$SERVICE_NAME" 2>/dev/null || true
    systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "$SERVICE_DEST"
    systemctl --user daemon-reload
    echo "Uninstalled."
    exit 0
fi

# ── Guards ────────────────────────────────────────────────────────────────────
if [ ! -f "$HOME/.playgen.env" ]; then
    echo "ERROR: $HOME/.playgen.env not found."
    echo "  cp $PROJECT_DIR/tools/task-daemon/deploy/playgen.env.example $HOME/.playgen.env"
    exit 1
fi

command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 not found"; exit 1; }

# Check systemd is available (may not be in basic WSL setups)
if ! systemctl --user status >/dev/null 2>&1; then
    echo "ERROR: systemd user session not available."
    echo "  On WSL2: ensure systemd=true in /etc/wsl.conf and restart WSL."
    exit 1
fi

# ── Ensure only this daemon variant is running ────────────────────────────────
if command -v docker >/dev/null 2>&1; then
    if docker inspect playgen-task-daemon --format='{{.State.Running}}' 2>/dev/null | grep -q true; then
        echo "Stopping Docker container version..."
        docker stop playgen-task-daemon 2>/dev/null || true
    fi
fi

# ── Install service ───────────────────────────────────────────────────────────
mkdir -p "$SYSTEMD_USER_DIR" "$HOME/.playgen/state" "$HOME/.playgen/logs"
chmod +x "$SCRIPT_DIR/run-daemon.sh"

sed \
    -e "s|INSTALL_PATH|$PROJECT_DIR|g" \
    -e "s|HOMEDIR|$HOME|g" \
    "$SCRIPT_DIR/playgen-task-daemon.service" \
    > "$SERVICE_DEST"

systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE_NAME"

echo ""
echo "PlayGen Task Daemon installed as systemd user service."
echo "  Status : systemctl --user status $SERVICE_NAME"
echo "  Logs   : journalctl --user -u $SERVICE_NAME -f"
echo "  Stop   : systemctl --user stop $SERVICE_NAME"
echo "  Remove : sh $SCRIPT_DIR/install.sh --uninstall"
