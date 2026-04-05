# Agent-Ops Framework

A portable, drop-in automation framework for AI-assisted software development teams.
Extracted from PlayGen and generalized to work with any GitHub-hosted project.

---

## What This Framework Provides

| Component | What it does |
|---|---|
| **daemon** | Agent pool manager — wakes at Claude Code reset windows, manages N agent slots, deduplicates running slots, auto-spawns Claude Code workers |
| **tg-agent** | Telegram command interface — `/status /health /prs /ci /issues /pool /merge` |
| **scripts/project-health.sh** | Reads `tasks/TODO.md`, counts `[x]/[ ]` per phase, exits 1 on P0 blockers |
| **scripts/simulate-deploy.sh** | Runs production build steps locally before pushing to CD |
| **workflows/ci.yml** | Parallel lint / typecheck / unit tests / Docker build matrix / project health |
| **workflows/cd.yml** | GHCR push + DB migration + Vercel/Railway deploy + smoke tests |
| **templates/CLAUDE.md** | Claude agent instructions template |
| **templates/agent-collab.md** | Shared lock file for concurrent agent coordination |
| **templates/lessons.md** | Self-improvement log — agents append lessons after corrections |
| **bootstrap.sh** | One-command setup that installs everything and starts Docker services |

---

## Prerequisites

- **GitHub repository** with Actions enabled
- **Telegram bot** (create via [@BotFather](https://t.me/BotFather)) + your chat ID
- **Claude Code** CLI installed (optional — enables auto-spawning)
- **Docker** (to run daemon and tg-agent)
- **Python 3.8+** (for daemon and bootstrap config generation)
- **GitHub PAT** with `repo` + `project` scopes (for daemon's GitHub API calls)

---

## Quick Start

```bash
# From your project root (where .github/ lives)
bash tools/agent-ops/bootstrap.sh \
  --project MyApp \
  --repo owner/repo \
  --telegram-token "7xxxxxxxxx:AAF..." \
  --telegram-chat "-1001234567890"
```

Bootstrap will:
1. Copy CI/CD workflow templates to `.github/workflows/`
2. Install `CLAUDE.md`, `tasks/agent-collab.md`, `tasks/lessons.md`
3. Install `scripts/project-health.sh` and `scripts/simulate-deploy.sh`
4. Generate `tools/agent-ops/project.config.json`
5. Create `tools/agent-ops/.env` with your Telegram credentials
6. Build Docker images and start daemon + tg-agent
7. Print a summary with next steps

After bootstrapping, edit `project.config.json` to fill in board IDs and service names.

---

## Configuration Reference

All project-specific values live in `tools/agent-ops/project.config.json`.
Copy `project.config.example.json` as your starting point.

### `project` section

| Field | Description |
|---|---|
| `name` | Project name (used in agent prompts) |
| `repo` | `owner/repo` for GitHub API calls |
| `workdir` | Working directory inside agent containers |
| `board_number` | GitHub Project board number |
| `board_owner` | Owner of the GitHub Project (user or org) |
| `board_id` | Project node ID (`PVT_xxx`) — from `gh project list` |
| `status_field_id` | Status field node ID (`PVTSSF_xxx`) — from `gh project field-list` |
| `board_columns` | Map of column names → option IDs |

To find your board IDs:
```bash
export PATH=/opt/homebrew/bin:$PATH

# Get board_id
gh project list --owner YOUR_OWNER --format json | python3 -c \
  "import json,sys; [print(p['id'], p['title']) for p in json.load(sys.stdin)['projects']]"

# Get status_field_id and column option IDs
gh project field-list BOARD_NUMBER --owner YOUR_OWNER --format json | python3 -c \
  "import json,sys
   for f in json.load(sys.stdin)['fields']:
       if f['name'] == 'Status':
           print('field_id:', f['id'])
           for opt in f.get('options', []):
               print(' ', opt['name'], '->', opt['id'])"
```

### `pool` section

Each key is a slot ID, value is `{type, always, desc}`.

```json
"pool": {
  "pm-0":          {"type": "pm",         "always": true,  "desc": "Project manager"},
  "ticket-bug-0":  {"type": "ticket-bug", "always": true,  "desc": "Bugfix worker #1"},
  "ticket-bug-1":  {"type": "ticket-bug", "always": false, "desc": "Bugfix worker #2"},
  "ticket-feat-0": {"type": "ticket-feat","always": false, "desc": "Feature worker"},
  "merge-0":       {"type": "merge",      "always": true,  "desc": "PR/Merge checker"},
  "health-0":      {"type": "health",     "always": true,  "desc": "Health check"}
}
```

Built-in types: `pm`, `ticket-bug`, `ticket-feat`, `merge`, `health`.

`always: true` means the slot spawns even when no relevant work exists.
`always: false` means the slot is skipped when its work type has no items.

### `reset_hours` section

Array of hours (0–23, in `timezone_offset_hours` timezone) when the daemon wakes and evaluates the pool.

Default: `[0, 5, 9, 14, 19]` — five windows throughout the day.

### `tech` section

| Field | Description |
|---|---|
| `package_manager` | `pnpm`, `npm`, or `yarn` |
| `test_command` | Command for unit tests |
| `build_command` | Command for production build |
| `lint_command` | Lint command |
| `typecheck_command` | TypeScript check command (omit if not TS) |
| `health_script` | Full shell command for health check |
| `collab_file` | Path to agent-collab.md |
| `docker_services` | Array of service names for Docker build simulation |

### `deploy` section

| Field | Description |
|---|---|
| `vercel` | `true` to include Vercel deployment in CD |
| `railway` | `true` to include Railway deployment in CD |
| `frontend_dir` | Relative path to frontend directory |

---

## How to Customize the Agent Pool

### Changing slot counts

Edit `pool` in `project.config.json`. Add or remove entries:

```json
"ticket-bug-2": {"type": "ticket-bug", "always": false, "desc": "Bugfix worker #3"}
```

### Adding new agent types

1. Add a new slot with a custom type string (e.g. `"type": "docs"`)
2. The daemon will build a generic prompt for unknown types
3. To add a custom prompt, edit `daemon/daemon.py` and add a case in `build_prompt()`:

```python
elif slot_type == "docs":
    return (
        f"You are the documentation agent for {PROJECT_NAME} at {WORKDIR}. "
        f"Check docs/ for outdated content and open PRs to fix it."
    )
```

### Adjusting priority rules

The pool manager applies these rules in order (in `manage_pool()`):

1. `ticket-bug-1` is skipped if no bug issues exist (enforces minimum 1 bug worker)
2. `ticket-feat-*` slots are skipped if no feature issues exist
3. `merge-*` slots are skipped if no open PRs exist
4. Running slots are never re-spawned (dedup via log-file mtime check)
5. Slots are re-spawned on: `limit_hit`, `completed`, `stale`, or `unknown`

---

## Reset Window Schedule

The daemon sleeps until the next reset window, then evaluates and spawns agents.

Default schedule (UTC+8 / Manila time):

| Window | Time |
|---|---|
| Night | 00:01 |
| Early morning | 05:01 |
| Morning | 09:01 |
| Afternoon | 14:01 |
| Evening | 19:01 |

To change, edit `reset_hours` in `project.config.json`. The `timezone_offset_hours` field controls the timezone offset from UTC.

---

## Enabling Auto-Spawn (CLAUDE_BIN)

By default, the daemon operates in **notify-only mode** — it evaluates the pool, sends Telegram messages describing what needs to happen, but does not actually spawn Claude Code agents.

To enable auto-spawning:

1. Install Claude Code and find the binary path:
   ```bash
   which claude
   # e.g. /opt/homebrew/bin/claude
   ```

2. Add to `tools/agent-ops/.env`:
   ```
   CLAUDE_BIN=/opt/homebrew/bin/claude
   CLAUDE_FLAGS=--dangerously-skip-permissions
   ```

3. Mount the binary into the daemon container (edit `daemon/docker-compose.yml`):
   ```yaml
   volumes:
     - /opt/homebrew/bin/claude:/usr/local/bin/claude:ro
   ```

4. Restart the daemon:
   ```bash
   cd tools/agent-ops/daemon && docker-compose restart
   ```

The daemon verifies `CLAUDE_BIN` is a real file before attempting to spawn. If it's unset or missing, it falls back to notify-only mode and sends a Telegram warning.

---

## scripts/project-health.sh

Reads `tasks/TODO.md` (or `--todo-file PATH`) and reports phase completion.

```bash
# Basic usage
bash scripts/project-health.sh

# CI mode — exits 1 if any incomplete P0 item exists
bash scripts/project-health.sh --ci

# Custom TODO file
bash scripts/project-health.sh --todo-file docs/ROADMAP.md
```

Expected TODO format:
```markdown
## Phase 1: Core Setup

- [x] Set up database
- [x] Create API skeleton
- [ ] Write unit tests — P0

## Phase 2: Features

- [x] User authentication
- [ ] Dashboard UI
```

Output is a completion % table per phase. P0 items cause `--ci` to exit 1.

---

## scripts/simulate-deploy.sh

Runs production build steps locally before pushing to the CD pipeline.

```bash
# Simulate Vercel frontend build
bash scripts/simulate-deploy.sh --vercel

# Simulate Docker image builds (reads service list from project.config.json)
bash scripts/simulate-deploy.sh --docker

# Run both
bash scripts/simulate-deploy.sh --all

# Override services
bash scripts/simulate-deploy.sh --docker --services auth,api,frontend
```

---

## Troubleshooting

### Daemon not sending Telegram messages

- Check `.env` has correct `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
- Verify the bot has been started in the chat (send `/start` to the bot)
- Check Docker logs: `docker logs agent-ops-daemon-1`

### GitHub API returns empty results

- Check `GH_TOKEN` in `.env` has `repo` scope
- For project board access, the PAT also needs `project` scope
- Verify `project.repo` in `project.config.json` matches `owner/repo` exactly

### Agents not spawning

- Check `CLAUDE_BIN` points to a real file: `ls -la $CLAUDE_BIN`
- The binary must be accessible inside the container (mounted as a volume)
- Check daemon logs for `spawn_error` events

### Slot stuck as "running" after agent finished

- The daemon detects completion by log file mtime
- If the log file mtime is < 5 minutes ago, the slot is considered running
- Slots automatically transition to `completed` after 5 minutes of log inactivity
- Force a re-spawn by removing the slot from the registry:
  ```bash
  docker exec agent-ops-daemon-1 python3 -c \
    "import json; r=json.load(open('/state/agent-registry.json')); \
     del r['slot-id-here']; json.dump(r, open('/state/agent-registry.json','w'))"
  ```

### project.config.json not found

- The daemon looks for the config relative to its own location: `../project.config.json`
- Or set `CONFIG_FILE` env var to an absolute path
- In Docker, the config is mounted at `/app/project.config.json`

---

## File Layout

```
tools/agent-ops/
├── README.md                       ← This file
├── bootstrap.sh                    ← One-command setup
├── project.config.example.json     ← Config schema reference
├── project.config.json             ← Your config (gitignored)
├── .env                            ← Secrets (gitignored)
├── daemon/
│   ├── daemon.py                   ← Agent pool manager
│   ├── Dockerfile
│   └── docker-compose.yml
├── tg-agent/
│   ├── bot.py                      ← Telegram command bot
│   ├── Dockerfile
│   └── docker-compose.yml
├── scripts/
│   ├── project-health.sh           ← TODO.md phase progress
│   └── simulate-deploy.sh          ← Local pre-CD simulation
├── workflows/
│   ├── ci.yml                      ← CI template
│   └── cd.yml                      ← CD template
└── templates/
    ├── CLAUDE.md                   ← Claude agent instructions
    ├── agent-collab.md             ← Agent coordination lock
    └── lessons.md                  ← Self-improvement log
```
