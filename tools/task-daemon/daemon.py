"""
PlayGen Task Daemon v4
Maintains a permanent agent pool across all Claude Code reset windows.

Pool configuration (always maintained):
  ticket-bug-0      — bugfix worker #1  (always present)
  ticket-bug-1      — bugfix worker #2  (present when bugs exist)
  ticket-feat-0     — feature worker    (present when features exist, yields to bugs)
  merge-0           — PR/merge checker  (always present when PRs open)
  health-0          — health check      (always present)

Priority rules:
  - Bugs always before features (2 bug slots, 1 feature slot)
  - Always keep at least 1 bugfix worker running
  - Slots are only re-spawned when they are stopped (limit_hit / completed / stale)
  - Running slots are NEVER duplicated
"""
import os, time, json, subprocess, urllib.request, urllib.parse, threading
from datetime import datetime, timezone, timedelta
from typing import Optional

MANILA        = timezone(timedelta(hours=8))
TG_TOKEN      = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT       = int(os.environ["TELEGRAM_CHAT_ID"])
GH_TOKEN      = os.environ.get("GH_TOKEN", "")
GH_REPO       = os.environ.get("GH_REPO", "rinehardramos/playgen-project")
WORKDIR       = os.environ.get("WORKDIR", "/workspace")
CLAUDE_FLAGS  = os.environ.get("CLAUDE_FLAGS", "--dangerously-skip-permissions")


# ── System Discovery ──────────────────────────────────────────────────────────

def _which(name: str) -> str:
    """Return the full path of a binary if it exists, else empty string."""
    import shutil
    return shutil.which(name) or ""


def _detect_platform() -> str:
    import platform
    s = platform.system()
    if s == "Darwin":
        return "macos"
    if s == "Windows":
        return "windows"
    # Detect WSL
    try:
        with open("/proc/version") as f:
            if "microsoft" in f.read().lower():
                return "wsl"
    except Exception:
        pass
    return "linux"


def _discover_claude() -> str:
    """
    Find the platform-native claude binary.
    Prefers OS-managed installs over raw vm directories.
    Never returns a path to a Linux ELF on macOS.
    """
    platform = _detect_platform()

    # Explicit override always wins
    explicit = os.environ.get("CLAUDE_BIN", "")
    if explicit and os.path.isfile(explicit):
        return explicit

    if platform == "macos":
        # 1. Homebrew Cask symlink (updated automatically on brew upgrade)
        if os.path.isfile("/opt/homebrew/bin/claude"):
            return "/opt/homebrew/bin/claude"
        # 2. Latest version in Caskroom (fallback if symlink broken)
        cask_dir = "/opt/homebrew/Caskroom/claude-code"
        if os.path.isdir(cask_dir):
            versions = sorted(os.listdir(cask_dir))
            if versions:
                candidate = os.path.join(cask_dir, versions[-1], "claude")
                if os.path.isfile(candidate):
                    return candidate
        # 3. Intel Mac Homebrew
        if os.path.isfile("/usr/local/bin/claude"):
            return "/usr/local/bin/claude"

    elif platform in ("linux", "wsl"):
        # 1. System PATH
        found = _which("claude")
        if found:
            return found
        # 2. Linux claude-code-vm (same layout as container)
        vm_dir = os.path.expanduser("~/.config/Claude/claude-code-vm")
        if os.path.isdir(vm_dir):
            versions = sorted(os.listdir(vm_dir))
            if versions:
                candidate = os.path.join(vm_dir, versions[-1], "claude")
                if os.path.isfile(candidate):
                    return candidate

    # Final fallback: check PATH
    return _which("claude")


def _discover_tools() -> dict:
    """Check for all tools required by the daemon and agents."""
    platform = _detect_platform()
    claude   = _discover_claude()

    # Docker Desktop on macOS puts its CLI at a non-standard path
    _docker = (
        _which("docker") or
        "/Applications/Docker.app/Contents/Resources/bin/docker"
        if os.path.isfile("/Applications/Docker.app/Contents/Resources/bin/docker")
        else ""
    )

    tools = {
        "platform": platform,
        "python3":  _which("python3") or _which("python"),
        "claude":   claude,
        "gh":       _which("gh"),
        "git":      _which("git"),
        "docker":   _docker,
    }

    # Validate claude binary is executable and native (not ELF on macOS)
    if tools["claude"] and platform == "macos":
        try:
            with open(tools["claude"], "rb") as f:
                magic = f.read(4)
            if magic == b"\x7fELF":            # Linux ELF — wrong binary
                tools["claude"] = ""
                tools["claude_warn"] = "Found Linux ELF binary — install native: brew install --cask claude-code"
        except Exception:
            pass

    return tools


def _load_tool_cache() -> Optional[dict]:
    """Load cached tool discovery result if it exists and is recent (< 24h)."""
    cache_file = os.path.join(os.environ.get("PLAYGEN_STATE_DIR", "/state"), "tools.json")
    try:
        with open(cache_file) as f:
            data = json.load(f)
        age = time.time() - data.get("_cached_at", 0)
        if age < 86400:                          # 24-hour TTL
            # Still validate that cached binaries actually exist
            valid = all(
                (not v) or (k.startswith("_")) or os.path.isfile(v)
                for k, v in data.items()
                if k not in ("platform", "_cached_at", "claude_warn")
            )
            if valid:
                return data
    except Exception:
        pass
    return None


def _save_tool_cache(tools: dict):
    """Persist tool discovery results to state dir."""
    cache_file = os.path.join(os.environ.get("PLAYGEN_STATE_DIR", "/state"), "tools.json")
    try:
        os.makedirs(os.path.dirname(os.path.abspath(cache_file)), exist_ok=True)
        payload = dict(tools)
        payload["_cached_at"] = time.time()
        with open(cache_file, "w") as f:
            json.dump(payload, f, indent=2)
    except Exception as e:
        print(f"[tools_cache] write failed: {e}", flush=True)


def _get_tools() -> dict:
    """Return tool discovery, using cache when available."""
    cached = _load_tool_cache()
    if cached:
        print("[tools] using cached discovery", flush=True)
        return cached
    print("[tools] running discovery...", flush=True)
    tools = _discover_tools()
    _save_tool_cache(tools)
    return tools


# Discover at startup (cached after first run) and expose as module-level constant
SYSTEM       = _get_tools()
CLAUDE_BIN   = SYSTEM["claude"]  # native binary or empty string

_STATE_DIR    = os.environ.get("PLAYGEN_STATE_DIR", "/state")
STATE_FILE    = os.path.join(_STATE_DIR, "agent-state.json")
REGISTRY_FILE = os.path.join(_STATE_DIR, "agent-registry.json")
TASK_LOG      = os.path.join(_STATE_DIR, "task-history.jsonl")

RESET_HOURS   = [0, 5, 9, 14, 19]   # Manila reset windows

# Agent log idle thresholds
RUNNING_IDLE_SECS   = 5 * 60     # < 5 min  → still running
COMPLETED_IDLE_SECS = 60 * 60    # 5–60 min → completed normally; >60 min → stale

# ─────────────────────────────────────────────────────────────────────────────
# Pool definition
# Each entry: slot_id → {type, always_spawn, description}
# ─────────────────────────────────────────────────────────────────────────────
POOL = {
    "pm-0":          {"type": "pm",          "always": True,  "desc": "Project manager (board, coordination, prioritization)"},
    "ticket-bug-0":  {"type": "ticket-bug",  "always": True,  "desc": "Bugfix worker #1 (priority)"},
    "ticket-bug-1":  {"type": "ticket-bug",  "always": False, "desc": "Bugfix worker #2 (when bugs exist)"},
    "ticket-feat-0": {"type": "ticket-feat", "always": False, "desc": "Feature worker (lower priority)"},
    "merge-0":       {"type": "merge",       "always": True,  "desc": "PR/Merge checker"},
    "health-0":      {"type": "health",      "always": True,  "desc": "Health check"},
}


# ── Telegram ──────────────────────────────────────────────────────────────────

def tg_send(text: str):
    url  = f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage"
    data = json.dumps({"chat_id": TG_CHAT, "text": text[:4000]}).encode()
    req  = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"[tg] {e}", flush=True)


def tg_get(endpoint: str, params: dict = None):
    import urllib.error
    url = f"https://api.telegram.org/bot{TG_TOKEN}/{endpoint}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"[tg_get] {e}", flush=True)
        return {"ok": False, "result": [], "error_code": e.code}
    except Exception as e:
        # Network hiccup / timeout — return special code so poll loop retries fast
        is_timeout = "timed out" in str(e).lower() or "timeout" in str(e).lower()
        if not is_timeout:
            print(f"[tg_get] {e}", flush=True)
        return {"ok": False, "result": [], "error_code": -1 if is_timeout else 0}


def _run(cmd: str) -> str:
    """Run a shell command in WORKDIR, return combined stdout+stderr (truncated)."""
    env = os.environ.copy()
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    try:
        r = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            cwd=WORKDIR, env=env, timeout=30,
        )
        return (r.stdout + r.stderr).strip()
    except subprocess.TimeoutExpired:
        return "Command timed out (30s)"
    except Exception as e:
        return str(e)


def _handle_cmd(text: str) -> Optional[str]:
    """Dispatch a /command string and return the reply, or None to ignore."""
    text = text.strip()
    cmd  = text.split()[0].lower()

    if cmd == "/help":
        return (
            "PlayGen Daemon commands:\n"
            "/status        — CI + open PRs\n"
            "/pool          — agent slot status\n"
            "/next          — time until next reset\n"
            "/prs           — list open PRs\n"
            "/ci            — last 5 CI runs\n"
            "/health        — project health check\n"
            "/merge N       — squash-merge PR #N\n"
            "/spawn S       — force-spawn slot S\n"
            "/pm dsu        — run daily stand-up now\n"
            "/pm plan       — run sprint planning now\n"
            "/pm review     — run sprint review now\n"
            "/pm board      — run board sync now\n"
            "/sysinfo       — tool discovery report\n"
            "/help          — this message"
        )

    if cmd == "/sysinfo":
        s = SYSTEM
        ok  = lambda v: "✅" if v else "❌"
        lines = [
            f"🔍 System Discovery",
            f"Platform : {s.get('platform', '?')}",
            f"python3  : {ok(s.get('python3'))} {s.get('python3','not found')}",
            f"claude   : {ok(s.get('claude'))} {s.get('claude','not found')}",
            f"gh       : {ok(s.get('gh'))} {s.get('gh','not found')}",
            f"git      : {ok(s.get('git'))} {s.get('git','not found')}",
            f"docker   : {ok(s.get('docker'))} {s.get('docker','not found')}",
        ]
        if s.get("claude_warn"):
            lines.append(f"⚠️  {s['claude_warn']}")
        lines.append(f"\nWorkdir  : {WORKDIR}")
        lines.append(f"State dir: {_STATE_DIR}")
        return "\n".join(lines)

    if cmd == "/status":
        prs = _run(
            "gh pr list --state open --json number,title "
            "--jq '.[] | select(.title | test(\"feat|fix\"; \"i\")) "
            "| \"#\\(.number) \\(.title[:45])\"' | head -8"
        )
        ci = _run(
            "gh run list --limit 4 --json status,conclusion,headBranch "
            "--jq '.[] | \"\\(.headBranch[:28]): \\(.status)/\\(.conclusion)\"'"
        )
        return f"📊 Status\n\nOpen PRs:\n{prs or '(none)'}\n\nCI (last 4):\n{ci}"

    if cmd == "/pool":
        reg = load_registry()
        lines = []
        for slot_id in POOL:
            st = slot_status(slot_id)
            icon = {"running": "🟢", "limit_hit": "🔴", "completed": "✅",
                    "stale": "🟡", "unknown": "⚪"}.get(st, "❓")
            entry = reg.get(slot_id, {})
            age = ""
            if entry.get("spawned_at"):
                try:
                    d = datetime.now(MANILA) - datetime.fromisoformat(entry["spawned_at"])
                    age = f" ({int(d.total_seconds()//60)}m ago)"
                except Exception:
                    pass
            lines.append(f"{icon} {slot_id}: {st}{age}")
        return "🤖 Agent Pool:\n" + "\n".join(lines)

    if cmd == "/next":
        wait, nxt = seconds_until_next_reset()
        mins = int(wait // 60)
        return f"⏰ Next reset: {nxt.strftime('%H:%M')} Manila — in {mins}m"

    if cmd == "/prs":
        out = _run(
            "gh pr list --state open --json number,title "
            "--jq '.[] | \"#\\(.number) \\(.title[:50])\"'"
        )
        return f"📬 Open PRs:\n{out[:1500] or '(none)'}"

    if cmd == "/ci":
        out = _run(
            "gh run list --limit 5 --json status,conclusion,headBranch "
            "--jq '.[] | \"\\(.headBranch[:30]): \\(.status)/\\(.conclusion)\"'"
        )
        return f"🚦 CI Runs:\n{out}"

    if cmd == "/health":
        out = _run("bash scripts/project-health.sh 2>&1 | tail -25")
        return f"🏥 Health:\n{out[:1500]}"

    if cmd == "/merge":
        parts = text.split()
        if len(parts) != 2 or not parts[1].isdigit():
            return "Usage: /merge <pr_number>"
        out = _run(f"gh pr merge {parts[1]} --squash --delete-branch 2>&1")
        return f"🔀 Merge #{parts[1]}:\n{out[:400]}"

    if cmd == "/spawn":
        parts = text.split()
        if len(parts) != 2 or parts[1] not in POOL:
            valid = ", ".join(POOL.keys())
            return f"Usage: /spawn <slot>\nValid slots: {valid}"
        slot_id = parts[1]
        bugs, feats, fp, dp = fetch_work()
        slot_type  = POOL[slot_id]["type"]
        slot_index = int(slot_id.rsplit("-", 1)[-1])
        if slot_type == "pm":
            p = prompt_pm(bugs, feats, fp, dp, mode=pm_mode())
        elif slot_type == "ticket-bug":
            p = prompt_ticket_bug(bugs, feats, slot_index)
        elif slot_type == "ticket-feat":
            p = prompt_ticket_feat(feats, bugs)
        elif slot_type == "merge":
            p = prompt_merge(fp, dp)
        elif slot_type == "health":
            p = prompt_health()
        else:
            return f"Unknown slot type: {slot_type}"
        if not p:
            return f"⏭ {slot_id}: no work available right now"
        ok = spawn(slot_id, p)
        return f"{'✅ Spawned' if ok else '❌ Failed to spawn'} {slot_id}"

    if cmd == "/pm":
        parts    = text.split()
        sub      = parts[1].lower() if len(parts) > 1 else ""
        mode_map = {"dsu": "dsu", "plan": "sprint_planning",
                    "review": "sprint_review", "board": "board_sync"}
        if sub not in mode_map:
            return "Usage: /pm <dsu|plan|review|board>"
        bugs, feats, fp, dp = fetch_work()
        p  = prompt_pm(bugs, feats, fp, dp, mode=mode_map[sub])
        ok = spawn("pm-0", p)
        labels = {"dsu": "🌅 DSU", "plan": "📋 Sprint Planning",
                  "review": "📊 Sprint Review", "board": "🗂 Board Sync"}
        return f"{'✅ Spawned' if ok else '❌ Failed'} pm-0 ({labels[sub]})"

    return None  # unknown command — ignore


def tg_poll_loop():
    """Background thread: long-poll Telegram and handle /commands from TG_CHAT."""
    offset     = 0
    poll_secs  = 20          # long-poll window; keep < 25 to leave margin
    backoff    = 5           # initial retry delay
    MAX_BACKOFF = 120        # cap

    print("[tg_poll] started — waiting 5s for any stale session to expire", flush=True)
    time.sleep(5)            # brief startup grace so prior process's connection clears

    while True:
        resp = tg_get("getUpdates", {
            "timeout": poll_secs,
            "offset":  offset,
            "allowed_updates": ["message"],
        })
        if not resp.get("ok"):
            code = resp.get("error_code", 0)
            if code == 409:
                # Competing getUpdates session — wait for it to expire
                wait = max(poll_secs + 6, backoff)
                print(f"[tg_poll] 409 conflict — waiting {wait}s", flush=True)
                time.sleep(wait)
                backoff = min(backoff * 2, MAX_BACKOFF)
            elif code == -1:
                # Network timeout — retry immediately (expected for long-poll)
                pass
            else:
                time.sleep(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF)
            continue
        backoff = 5          # reset on success
        for update in resp.get("result", []):
            offset = update["update_id"] + 1
            msg  = update.get("message", {})
            chat = msg.get("chat", {}).get("id")
            if chat != TG_CHAT:
                continue
            text = msg.get("text", "")
            if not text.startswith("/"):
                continue
            print(f"[tg_poll] cmd: {text}", flush=True)
            try:
                reply = _handle_cmd(text)
                if reply:
                    tg_send(reply)
            except Exception as e:
                tg_send(f"⚠️ Error: {e}")


# ── GitHub API ────────────────────────────────────────────────────────────────

def gh(path: str):
    url  = f"https://api.github.com/repos/{GH_REPO}/{path}"
    hdrs = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {GH_TOKEN}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=hdrs), timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"[gh] {path}: {e}", flush=True)
        return []


def fetch_work():
    """Return (bug_issues, feat_issues, feature_prs, dep_prs)."""
    prs    = gh("pulls?state=open&per_page=100")
    issues = gh("issues?state=open&per_page=100")

    feature_prs = [p for p in (prs if isinstance(prs, list) else []) if not _is_dep(p)]
    dep_prs     = [p for p in (prs if isinstance(prs, list) else []) if _is_dep(p)]

    all_issues  = [
        i for i in (issues if isinstance(issues, list) else [])
        if "pull_request" not in i and not _is_dep(i)
    ]
    bug_issues  = [i for i in all_issues if _is_bug(i)]
    feat_issues = [i for i in all_issues if not _is_bug(i)]

    return bug_issues, feat_issues, feature_prs, dep_prs


def _is_dep(item):
    return "dependabot" in item.get("user", {}).get("login", "") or \
           any(k in item.get("title", "").lower() for k in ["bump ", "chore(deps"])


def _is_bug(issue):
    labels = [l.get("name", "").lower() for l in issue.get("labels", [])]
    return any(k in labels for k in ["bug", "p0", "hotfix", "critical", "fix"])


# ── Agent Registry ────────────────────────────────────────────────────────────

def load_registry() -> dict:
    try:
        with open(REGISTRY_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_registry(reg: dict):
    os.makedirs(os.path.dirname(os.path.abspath(REGISTRY_FILE)), exist_ok=True)
    with open(REGISTRY_FILE, "w") as f:
        json.dump(reg, f, indent=2)


def slot_status(slot_id: str) -> str:
    """
    Inspect the log file of a slot to determine its current status.

    running    → log modified <5 min ago, no limit marker
    limit_hit  → log tail contains usage-limit message
    completed  → log idle 5-60 min, clean exit
    stale      → log idle >60 min
    unknown    → no registry entry or log file missing
    """
    reg   = load_registry()
    entry = reg.get(slot_id)
    if not entry:
        return "unknown"

    log_file = entry.get("log_file", "")

    # No log yet — use spawn time to infer
    if not log_file or not os.path.exists(log_file):
        try:
            age = (datetime.now(MANILA) - datetime.fromisoformat(entry["spawned_at"])).total_seconds()
            return "running" if age < RUNNING_IDLE_SECS else "unknown"
        except Exception:
            return "unknown"

    idle = time.time() - os.path.getmtime(log_file)

    # Read tail for limit marker
    try:
        with open(log_file, "rb") as f:
            f.seek(max(0, os.path.getsize(log_file) - 600))
            tail = f.read().decode("utf-8", errors="ignore").lower()
    except Exception:
        tail = ""

    # Recent activity wins over limit markers — if the log was written in the last
    # RUNNING_IDLE_SECS, the agent is still alive and producing output.
    if idle < RUNNING_IDLE_SECS:
        return "running"
    if any(p in tail for p in ["hit your limit", "usage limit", "resets 9am", "resets 9 am"]):
        return "limit_hit"
    if idle < COMPLETED_IDLE_SECS:
        return "completed"
    return "stale"


def needs_spawn(slot_id: str) -> tuple[bool, str]:
    """Return (should_spawn, reason)."""
    status = slot_status(slot_id)
    if status == "running":
        return False, "running — skip"
    if status == "limit_hit":
        return True,  "limit_hit — re-spawn"
    if status == "completed":
        return True,  "completed — re-spawn for new work"
    if status == "stale":
        return True,  "stale — re-spawn"
    return True, "unknown — spawn fresh"


# ── Claude Spawner ────────────────────────────────────────────────────────────

def spawn(slot_id: str, prompt: str) -> bool:
    if not CLAUDE_BIN or not os.path.isfile(CLAUDE_BIN):
        return False
    state_dir = os.path.dirname(os.path.abspath(STATE_FILE))
    log_file = os.path.join(state_dir, f"{slot_id}-{int(time.time())}.log")
    try:
        subprocess.Popen(
            [CLAUDE_BIN] + CLAUDE_FLAGS.split() + ["-p", prompt],
            cwd=WORKDIR,
            stdout=open(log_file, "w"),
            stderr=subprocess.STDOUT,
        )
        reg = load_registry()
        reg[slot_id] = {"log_file": log_file, "spawned_at": _now(), "status": "running"}
        save_registry(reg)
        _log("spawned", f"{slot_id} → {log_file}")
        return True
    except Exception as e:
        _log("spawn_error", f"{slot_id}: {e}")
        return False


# ── Prompt Builders ───────────────────────────────────────────────────────────

def prompt_ticket_bug(bug_issues, feat_issues, slot_index: int):
    """Bugfix worker — prioritises bugs, falls back to features if no bugs."""
    if bug_issues:
        targets = bug_issues[slot_index * 2: slot_index * 2 + 2]  # 2 bugs per slot
        issue_str = " | ".join(f"#{i['number']} [{i['title'][:35]}]" for i in targets)
        task_desc = f"BUG issues (priority): {issue_str}"
    elif feat_issues:
        targets   = feat_issues[:2]
        issue_str = " | ".join(f"#{i['number']} [{i['title'][:35]}]" for i in targets)
        task_desc = f"No bugs found — falling back to feature issues: {issue_str}"
    else:
        task_desc = "No open issues found — run health check and report via Telegram."

    return (
        f"You are ticket-bug worker #{slot_index + 1} for PlayGen at /workspace. "
        f"export PATH=/opt/homebrew/bin:$PATH. "
        f"Priority: fix bugs before features. {task_desc}. "
        f"Rules: 1) Read tasks/agent-collab.md 2) gh pr list --state open before claiming "
        f"3) branch fix/issue-N or feat/issue-N 4) implement + tests + PR 5) update agent-collab.md. "
        f"Base branch: main."
    )


def prompt_ticket_feat(feat_issues, bug_issues):
    """Feature worker — only picks up features, defers to bug workers for bugs."""
    # Skip features that bug workers might already be handling
    available = feat_issues[:3]
    if not available and not bug_issues:
        return None  # Nothing to do
    if not available:
        return None  # Let bug workers handle remaining bugs
    issue_str = " | ".join(f"#{i['number']} [{i['title'][:35]}]" for i in available)
    return (
        f"You are the feature ticket worker for PlayGen at /workspace. "
        f"export PATH=/opt/homebrew/bin:$PATH. "
        f"ONLY work on FEATURE issues (not bugs — those are handled by other workers). "
        f"Feature issues: {issue_str}. "
        f"Rules: 1) Read tasks/agent-collab.md 2) gh pr list --state open before claiming "
        f"3) branch feat/issue-N 4) implement + tests + PR 5) update agent-collab.md. "
        f"Base branch: main."
    )


def prompt_merge(feature_prs, dep_prs):
    """Unified PR/merge checker for all open PRs."""
    feat_list = " ".join(f"#{p['number']}" for p in feature_prs[:12])
    dep_list  = " ".join(f"#{p['number']}" for p in dep_prs[:20])
    parts = []
    if feat_list:
        parts.append(f"Feature PRs: {feat_list}")
    if dep_list:
        parts.append(f"Dep PRs: {dep_list}")
    if not parts:
        return None  # No PRs to merge

    return (
        f"You are the PR/merge checker for PlayGen at /workspace. "
        f"export PATH=/opt/homebrew/bin:$PATH. "
        f"{'. '.join(parts)}. "
        f"For each PR: gh pr checks → wait if pending → resolve conflicts "
        f"(keep main for CHANGELOG/agent-collab, pnpm install for lockfile) → "
        f"gh pr merge --squash --delete-branch. "
        f"Dep PRs: merge if green, close if major breaking change. "
        f"Merge feature PRs first (highest risk), then deps. One at a time."
    )


def pm_mode() -> str:
    """Return the ceremony mode for the PM agent based on current Manila time/day."""
    now = datetime.now(MANILA)
    wd, h = now.weekday(), now.hour  # 0=Mon … 6=Sun
    if wd == 0 and h == 0:  return "sprint_planning"   # Monday midnight
    if wd == 6 and h == 19: return "sprint_review"     # Sunday 19:00
    if wd < 5  and h == 9:  return "dsu"               # Weekday morning
    return "board_sync"


# ── Board/project constants used across PM prompts ────────────────────────────
_PROJ_ID    = "PVT_kwHOAXQAu84BTrFP"
_FIELD_ID   = "PVTSSF_lAHOAXQAu84BTrFPzhA4e9s"
_OPT_DONE   = "c2007256"
_OPT_REVIEW = "22fda963"
_OPT_INPROG = "9a158f4d"
_OPT_TODO   = "00c6ca1e"
_OPT_BACKLOG = "8a624c5e"
_GH_OWNER   = "rinehardramos"
_GH_PROJ    = "2"


def prompt_pm(bugs, feats, feature_prs, dep_prs, mode: str = "board_sync"):
    """Project manager — dispatches to the correct ceremony prompt."""
    if mode == "dsu":
        return _prompt_pm_dsu(bugs, feats, feature_prs)
    if mode == "sprint_planning":
        return _prompt_pm_sprint_planning(bugs, feats)
    if mode == "sprint_review":
        return _prompt_pm_sprint_review()
    return _prompt_pm_board_sync(bugs, feats, feature_prs, dep_prs)


def _prompt_pm_board_sync(bugs, feats, feature_prs, dep_prs):
    """Regular cycle: board sync, prioritization, coordination, duplicate cleanup."""
    bug_list  = " ".join(f"#{i['number']}" for i in bugs[:10])
    feat_list = " ".join(f"#{i['number']}" for i in feats[:10])
    pr_list   = " ".join(f"#{p['number']}" for p in feature_prs[:8])

    return (
        f"You are the Project Manager agent for PlayGen at /workspace. "
        f"export PATH=/opt/homebrew/bin:$PATH. "
        f"Your responsibilities this cycle:\n\n"

        f"1. BOARD SYNC — Update GitHub project board (project #{_GH_PROJ}, owner {_GH_OWNER}):\n"
        f"   - gh project item-list {_GH_PROJ} --owner {_GH_OWNER} --format json\n"
        f"   - Any issue with a merged PR → move to Done ({_OPT_DONE})\n"
        f"   - Any issue with an open PR → move to Review ({_OPT_REVIEW})\n"
        f"   - Any In Progress issue with NO commit in last 24h → move to Todo ({_OPT_TODO})\n"
        f"   - Project-id: {_PROJ_ID}, field-id: {_FIELD_ID}\n\n"

        f"2. TICKET PRIORITIZATION:\n"
        f"   Bugs: {bug_list or 'none'}  Features: {feat_list or 'none'}\n"
        f"   - Add 'bug' label if title has fix/error/crash/broken\n"
        f"   - Add 'P0' to production-breaking bugs; 'P1' to user-facing gaps\n"
        f"   - Close duplicate issues (same topic, keep newest)\n\n"

        f"3. AGENT COORDINATION — tasks/agent-collab.md:\n"
        f"   - Clear stale claims (>24h, no PR opened) from Active Work\n"
        f"   - Write '## Next Recommended Tickets' at top: top 2 bugs, top 1 feature\n"
        f"   - No two active claims for the same issue\n\n"

        f"4. PR COORDINATION — Open PRs: {pr_list or 'none'}\n"
        f"   - Two PRs for same issue → close older as duplicate\n"
        f"   - PR open >48h with no review → add 'needs-review' label\n\n"

        f"5. REPORT — curl -s -X POST 'https://api.telegram.org/bot{TG_TOKEN}/sendMessage' "
        f"-H 'Content-Type: application/json' "
        f"-d '{{\"chat_id\":\"{TG_CHAT}\",\"text\":\"🗂 PM: X board moves | Y label updates | Z stale cleared\"}}'\n\n"

        f"Do NOT implement any code — only manage coordination and labels."
    )


def _prompt_pm_dsu(bugs, feats, feature_prs):
    """Daily Stand-Up: yesterday/today/blockers report."""
    bug_list  = " ".join(f"#{i['number']}" for i in bugs[:8])
    feat_list = " ".join(f"#{i['number']}" for i in feats[:8])
    pr_list   = " ".join(f"#{p['number']}" for p in feature_prs[:6])
    today     = datetime.now(MANILA).strftime("%Y-%m-%d")

    return (
        f"You are the Project Manager agent for PlayGen at /workspace. "
        f"export PATH=/opt/homebrew/bin:$PATH. "
        f"Today ({today}) is a DAILY STAND-UP cycle. Do NOT write any code.\n\n"

        f"1. YESTERDAY — What was shipped (last 24h):\n"
        f"   gh pr list --state merged --repo {_GH_OWNER}/playgen-project "
        f"--json number,title,mergedAt "
        f"--jq '.[] | select(.mergedAt > (now - 86400 | todate)) | \"#\\(.number) \\(.title)\"'\n"
        f"   gh issue list --state closed --repo {_GH_OWNER}/playgen-project "
        f"--json number,title,closedAt "
        f"--jq '.[] | select(.closedAt > (now - 86400 | todate)) | \"#\\(.number) \\(.title)\"'\n\n"

        f"2. TODAY — Current active work:\n"
        f"   Read tasks/agent-collab.md → list each Active Work entry with owner and age\n"
        f"   Active issues: bugs {bug_list or 'none'}, features {feat_list or 'none'}, PRs {pr_list or 'none'}\n\n"

        f"3. BLOCKERS — Surface any of:\n"
        f"   a) Active claims >12h with no PR opened → stale blocker\n"
        f"   b) P0/P1 issues with no active claim → unassigned priority\n"
        f"   c) Open PRs with CI failure:\n"
        f"      gh pr list --state open --repo {_GH_OWNER}/playgen-project "
        f"--json number,title,statusCheckRollup "
        f"--jq '.[] | select(.statusCheckRollup[]?.conclusion? == \"FAILURE\") | \"#\\(.number) \\(.title)\"'\n\n"

        f"4. DSU FILE — Write to /state/dsu-{today}.md:\n"
        f"   # DSU — {today}\n"
        f"   ## Yesterday\n   ## Today\n   ## Blockers\n\n"

        f"5. TELEGRAM REPORT — Send condensed DSU (under 800 chars):\n"
        f"   curl -s -X POST 'https://api.telegram.org/bot{TG_TOKEN}/sendMessage' "
        f"-H 'Content-Type: application/json' "
        f"-d '{{\"chat_id\":\"{TG_CHAT}\","
        f"\"text\":\"🌅 DSU {today}\\n✅ Yesterday: <merged/closed>\\n"
        f"🔧 Today: <active claims>\\n🚧 Blockers: <blockers or none>\"}}'  \n\n"

        f"Do NOT implement any code — only read state, write DSU file, send Telegram."
    )


def _prompt_pm_sprint_planning(bugs, feats):
    """Weekly sprint planning: pick tickets, write sprint-plan.md, update board."""
    week_num  = datetime.now(MANILA).isocalendar()[1]
    today     = datetime.now(MANILA).strftime("%Y-%m-%d")
    bug_list  = " ".join(f"#{i['number']}" for i in bugs[:15])
    feat_list = " ".join(f"#{i['number']}" for i in feats[:15])

    return (
        f"You are the Project Manager agent for PlayGen at /workspace. "
        f"export PATH=/opt/homebrew/bin:$PATH. "
        f"Today ({today}) is SPRINT PLANNING day (Week {week_num}). Do NOT write any code.\n\n"

        f"1. SPRINT CAPACITY — This week's agent capacity:\n"
        f"   - 2 bug slots × 5 resets/day × 7 days = ~10 bug tickets max\n"
        f"   - 1 feat slot × 5 resets/day × 7 days = ~5 feature tickets max\n"
        f"   - Total: pick up to 8 bugs + 4 features (leave buffer for unknowns)\n\n"

        f"2. SELECT TICKETS — From open issues, pick by priority (P0 > P1 > P2, then age):\n"
        f"   gh issue list --state open --repo {_GH_OWNER}/playgen-project "
        f"--label bug --json number,title,labels,createdAt --limit 20\n"
        f"   gh issue list --state open --repo {_GH_OWNER}/playgen-project "
        f"--label enhancement --json number,title,labels,createdAt --limit 20\n"
        f"   Current bugs: {bug_list or 'none'}\n"
        f"   Current features: {feat_list or 'none'}\n\n"

        f"3. WRITE SPRINT PLAN — Append to tasks/sprint-plan.md:\n"
        f"   ## Sprint {week_num} — {today}\n"
        f"   ### Committed\n"
        f"   - Bug: #N — title  [P0/P1/P2]\n"
        f"   - Feat: #N — title  [P1/P2]\n"
        f"   ### Capacity: X bugs + Y features\n"
        f"   ### Notes\n\n"

        f"4. UPDATE BOARD — Move selected Backlog items to Todo ({_OPT_TODO}):\n"
        f"   For each selected issue:\n"
        f"     ITEM=$(gh project item-add {_GH_PROJ} --owner {_GH_OWNER} "
        f"--url https://github.com/{_GH_OWNER}/playgen-project/issues/N --format json | "
        f"python3 -c \"import json,sys; print(json.load(sys.stdin)['id'])\")\n"
        f"     gh project item-edit --project-id {_PROJ_ID} --id $ITEM "
        f"--field-id {_FIELD_ID} --single-select-option-id {_OPT_TODO}\n\n"

        f"5. UPDATE AGENT-COLLAB — Prepend sprint summary to tasks/agent-collab.md:\n"
        f"   ## Sprint {week_num} Recommended Tickets\n"
        f"   Bugs: top 2 by P0/P1  |  Feature: top 1\n\n"

        f"6. TELEGRAM REPORT:\n"
        f"   curl -s -X POST 'https://api.telegram.org/bot{TG_TOKEN}/sendMessage' "
        f"-H 'Content-Type: application/json' "
        f"-d '{{\"chat_id\":\"{TG_CHAT}\","
        f"\"text\":\"📋 Sprint {week_num} Plan\\nBugs: X | Features: Y\\nTop: #N #N #N\"}}'\n\n"

        f"Do NOT implement any code — only select tickets, write plan, update board."
    )


def _prompt_pm_sprint_review():
    """Weekly sprint review: measure velocity, record outcomes, send summary."""
    now       = datetime.now(MANILA)
    week_num  = now.isocalendar()[1]
    today     = now.strftime("%Y-%m-%d")
    week_ago  = (now - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")

    return (
        f"You are the Project Manager agent for PlayGen at /workspace. "
        f"export PATH=/opt/homebrew/bin:$PATH. "
        f"Today ({today}) is SPRINT REVIEW day (Week {week_num}). Do NOT write any code.\n\n"

        f"1. WHAT WAS COMPLETED — Merged PRs and closed issues this sprint (last 7 days):\n"
        f"   gh pr list --state merged --repo {_GH_OWNER}/playgen-project "
        f"--json number,title,mergedAt "
        f"--jq '.[] | select(.mergedAt >= \"{week_ago}\") | \"#\\(.number) \\(.title)\"'\n"
        f"   gh issue list --state closed --repo {_GH_OWNER}/playgen-project "
        f"--json number,title,closedAt "
        f"--jq '.[] | select(.closedAt >= \"{week_ago}\") | \"#\\(.number) \\(.title)\"'\n\n"

        f"2. PLANNED vs ACTUAL — Read tasks/sprint-plan.md:\n"
        f"   Find '## Sprint {week_num}' section → list Committed tickets\n"
        f"   Mark each: ✅ Done / 🔄 Carry-over / ❌ Dropped\n"
        f"   Velocity = done / committed (as percentage)\n\n"

        f"3. CARRY-OVERS — For unfinished planned tickets:\n"
        f"   Keep in Todo on board (do NOT move back to Backlog)\n"
        f"   Add '(carry-over)' note in next sprint plan\n\n"

        f"4. WRITE REVIEW — Append to tasks/sprint-plan.md:\n"
        f"   ### Review — {today}\n"
        f"   Velocity: X/Y (Z%)\n"
        f"   ✅ Done: list\n"
        f"   🔄 Carry-over: list\n"
        f"   ❌ Dropped: list with reason\n"
        f"   ### Retrospective Notes\n\n"

        f"5. TELEGRAM REPORT:\n"
        f"   curl -s -X POST 'https://api.telegram.org/bot{TG_TOKEN}/sendMessage' "
        f"-H 'Content-Type: application/json' "
        f"-d '{{\"chat_id\":\"{TG_CHAT}\","
        f"\"text\":\"📊 Sprint {week_num} Review\\nVelocity: X/Y (Z%)\\n✅ N | 🔄 N\"}}'\n\n"

        f"Do NOT implement any code — only read state, write review, send Telegram."
    )


def prompt_health():
    return (
        f"Run PlayGen project health check at /workspace. "
        f"export PATH=/opt/homebrew/bin:$PATH. "
        f"1. bash scripts/project-health.sh 2>&1 | tail -20 "
        f"2. gh run list --limit 5 --json status,conclusion,headBranch "
        f"   --jq '.[] | \"\\(.headBranch[:25]): \\(.status)/\\(.conclusion)\"' "
        f"3. Send summary to Telegram (keep <400 chars): "
        f"curl -s -X POST 'https://api.telegram.org/bot{TG_TOKEN}/sendMessage' "
        f"-H 'Content-Type: application/json' "
        f"-d '{{\"chat_id\":\"{TG_CHAT}\",\"text\":\"SUMMARY\"}}'. Done."
    )


# ── Pool Manager ──────────────────────────────────────────────────────────────

def manage_pool():
    """Evaluate every slot in POOL and spawn/skip as needed."""
    bugs, feats, feature_prs, dep_prs = fetch_work()

    # Persist snapshot
    os.makedirs(os.path.dirname(os.path.abspath(STATE_FILE)), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump({
            "updated_at":   _now(),
            "bug_issues":   [{"number": i["number"], "title": i["title"]} for i in bugs],
            "feat_issues":  [{"number": i["number"], "title": i["title"]} for i in feats],
            "feature_prs":  [{"number": p["number"], "title": p["title"]} for p in feature_prs],
            "dep_prs":      [{"number": p["number"], "title": p["title"]} for p in dep_prs],
        }, f, indent=2)

    now_str = datetime.now(MANILA).strftime("%Y-%m-%d %H:%M")
    tg_send(
        f"⏰ {now_str} — reset window\n"
        f"🐛 {len(bugs)} bugs  ✨ {len(feats)} features  "
        f"📋 {len(feature_prs)} feat PRs  📦 {len(dep_prs)} dep PRs"
    )

    claude_ok = bool(CLAUDE_BIN and os.path.isfile(CLAUDE_BIN))
    results   = []

    for slot_id, cfg in POOL.items():
        slot_type   = cfg["type"]
        always      = cfg["always"]
        desc        = cfg["desc"]

        # Determine if there's work for this slot type
        has_work = {
            "pm":          True,                   # always runs — coordinates everything
            "ticket-bug":  bool(bugs or feats),    # always at least 1 bug slot
            "ticket-feat": bool(feats),
            "merge":       bool(feature_prs or dep_prs),
            "health":      True,
        }.get(slot_type, False)

        # ticket-bug-0 always spawns (min 1 bugfix worker)
        # ticket-bug-1 only when bugs actually exist
        if slot_id == "ticket-bug-1" and not bugs:
            results.append(f"  ⏭ {slot_id}: skipped (no bugs)")
            continue

        # feature worker skipped if no features
        if slot_type == "ticket-feat" and not feats:
            results.append(f"  ⏭ {slot_id}: skipped (no features)")
            continue

        # merge skipped if nothing to merge
        if slot_type == "merge" and not has_work:
            results.append(f"  ⏭ {slot_id}: skipped (no PRs)")
            continue

        ok, reason = needs_spawn(slot_id)
        if not ok:
            results.append(f"  🔄 {slot_id}: {reason}")
            continue

        if not claude_ok:
            results.append(f"  📋 {slot_id}: queued ({reason}) — claude not mounted")
            continue

        # Build prompt for this slot
        slot_index = int(slot_id.rsplit("-", 1)[-1])
        if slot_type == "pm":
            p = prompt_pm(bugs, feats, feature_prs, dep_prs, mode=pm_mode())
        elif slot_type == "ticket-bug":
            p = prompt_ticket_bug(bugs, feats, slot_index)
        elif slot_type == "ticket-feat":
            p = prompt_ticket_feat(feats, bugs)
        elif slot_type == "merge":
            p = prompt_merge(feature_prs, dep_prs)
        elif slot_type == "health":
            p = prompt_health()
        else:
            p = None

        if p is None:
            results.append(f"  ⏭ {slot_id}: skipped (no prompt — nothing to do)")
            continue

        launched = spawn(slot_id, p)
        icon     = "✅" if launched else "❌"
        results.append(f"  {icon} {slot_id} [{desc}]: {reason}")
        _log("spawned" if launched else "spawn_failed", f"{slot_id}: {reason}")

    tg_send("🤖 Pool status:\n" + "\n".join(results))
    if not claude_ok:
        tg_send("⚠️  Claude CLI not mounted — agents not auto-spawned. Set CLAUDE_BIN.")


# ── Scheduler ─────────────────────────────────────────────────────────────────

def seconds_until_next_reset():
    now  = datetime.now(MANILA)
    base = now.replace(second=0, microsecond=0)
    candidates = [base.replace(hour=h, minute=1) for h in RESET_HOURS
                  if base.replace(hour=h, minute=1) > now]
    if not candidates:
        nxt = (base + timedelta(days=1)).replace(hour=RESET_HOURS[0], minute=1)
    else:
        nxt = min(candidates)
    return (nxt - now).total_seconds(), nxt


def _now():
    return datetime.now(MANILA).isoformat()


def _log(event: str, detail: str = ""):
    os.makedirs(os.path.dirname(os.path.abspath(TASK_LOG)), exist_ok=True)
    with open(TASK_LOG, "a") as f:
        f.write(json.dumps({"ts": _now(), "event": event, "detail": detail}) + "\n")
    print(f"[{event}] {detail}", flush=True)


# ── Entry Point ───────────────────────────────────────────────────────────────

def main():
    os.makedirs(os.path.dirname(os.path.abspath(STATE_FILE)), exist_ok=True)
    reset_str = " | ".join(f"{h:02d}:00" for h in RESET_HOURS)
    claude_ok = bool(CLAUDE_BIN and os.path.isfile(CLAUDE_BIN))

    pool_lines = "\n".join(f"  {sid}: {cfg['desc']}" for sid, cfg in POOL.items())
    print(f"[daemon] started — resets: {reset_str}", flush=True)

    # Start Telegram command listener in background thread
    t = threading.Thread(target=tg_poll_loop, daemon=True, name="tg-poll")
    t.start()

    tg_send(
        f"🤖 PlayGen Task Daemon v4\n"
        f"Platform : {SYSTEM.get('platform','?')} | "
        f"Claude: {'✅' if claude_ok else '❌ not found'} | "
        f"gh: {'✅' if SYSTEM.get('gh') else '❌'}\n"
        f"Resets (Manila): {reset_str}\n\n"
        f"Agent pool:\n{pool_lines}\n\n"
        f"Rules: bugs > features | 2 bug workers | 1 feat | 1 merge | 1 health\n"
        f"Commands: /help /pool /status /sysinfo"
        + (f"\n⚠️  {SYSTEM['claude_warn']}" if SYSTEM.get("claude_warn") else "")
    )

    # Startup snapshot
    bugs, feats, fp, dp = fetch_work()
    _log("startup", f"{len(bugs)} bugs, {len(feats)} feats, {len(fp)} feat PRs, {len(dp)} dep PRs")

    last_hour = -1
    while True:
        wait, nxt = seconds_until_next_reset()
        print(
            f"[daemon] {datetime.now(MANILA).strftime('%H:%M:%S')} — "
            f"next reset {nxt.strftime('%H:%M')} Manila (in {wait/3600:.2f}h)",
            flush=True,
        )
        time.sleep(wait)

        cur_hour = datetime.now(MANILA).hour
        if cur_hour == last_hour:
            time.sleep(90)
            continue

        last_hour = cur_hour
        _log("reset_triggered", f"hour={cur_hour}")
        try:
            manage_pool()
        except Exception as e:
            _log("error", str(e))
            tg_send(f"⚠️ Daemon error: {e}")

        time.sleep(120)


if __name__ == "__main__":
    main()
