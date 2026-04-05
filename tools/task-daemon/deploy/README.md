# PlayGen Task Daemon — Deployment Variants

Four deployment options are available. **Run only ONE at a time** on any given machine.

| Variant | Platform | Mechanism | Auto-start |
|---------|----------|-----------|------------|
| **macOS** | macOS (Apple Silicon / Intel) | LaunchAgent | Login |
| **Linux** | Linux / WSL2 with systemd | systemd user service | Login |
| **Windows** | Windows 10/11 with WSL2 | Task Scheduler → WSL | Login |
| **Docker** | Any (Docker Desktop / Engine) | `docker-compose up -d` | Manual / Docker Desktop startup |

---

## 0. Prerequisites (all variants)

1. **Python 3.9+** installed and on PATH
2. **Claude Code CLI** installed (daemon auto-discovers latest version)
3. **Credentials** saved to `~/.playgen.env`:

```sh
cp tools/task-daemon/deploy/playgen.env.example ~/.playgen.env
# Edit with your TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GH_TOKEN
```

---

## macOS (LaunchAgent)

The daemon runs natively, starts at login, and restarts automatically on crash.

```sh
# Install
sh tools/task-daemon/deploy/macos/install.sh

# Monitor
launchctl list | grep playgen
tail -f ~/.playgen/logs/daemon.log

# Stop
launchctl unload ~/Library/LaunchAgents/com.playgen.task-daemon.plist

# Uninstall
sh tools/task-daemon/deploy/macos/install.sh --uninstall
```

---

## Linux (systemd user service)

Works on Ubuntu, Debian, Fedora, Arch, and **WSL2** (with `systemd=true` in `/etc/wsl.conf`).

```sh
# Install
sh tools/task-daemon/deploy/linux/install.sh

# Monitor
systemctl --user status playgen-task-daemon
journalctl --user -u playgen-task-daemon -f

# Stop
systemctl --user stop playgen-task-daemon

# Uninstall
sh tools/task-daemon/deploy/linux/install.sh --uninstall
```

> **WSL2 prerequisite**: Add to `/etc/wsl.conf`:
> ```ini
> [boot]
> systemd=true
> ```
> Then restart: `wsl --shutdown`

---

## Windows (Task Scheduler → WSL2)

The daemon runs inside your WSL2 distro, triggered by Windows Task Scheduler at login.
This means you get the full Linux environment without needing a container.

```powershell
# Install (run as normal user — not Administrator)
pwsh tools/task-daemon/deploy/windows/run-daemon.ps1

# Start now (after install)
Start-ScheduledTask -TaskName "PlayGen-Task-Daemon"

# Monitor (inside WSL)
wsl -- tail -f ~/.playgen/logs/daemon.log

# Uninstall
pwsh tools/task-daemon/deploy/windows/run-daemon.ps1 -Uninstall
```

> **WSL2 prerequisite**: Install WSL2 + a Linux distro (Ubuntu recommended):
> `wsl --install`

---

## Docker (containerised)

Best for servers or when you don't want to install python/deps locally.

```sh
cd tools/task-daemon
docker-compose up -d

# Monitor
docker logs -f playgen-task-daemon

# Stop
docker-compose down
```

---

## Mutual Exclusion

The install scripts for macOS and Linux automatically stop the Docker container if it is running.
For Windows/WSL, stop any running container before installing:

```sh
docker stop playgen-task-daemon 2>/dev/null || true
```

To switch variants, uninstall the current one first, then install the new one.
