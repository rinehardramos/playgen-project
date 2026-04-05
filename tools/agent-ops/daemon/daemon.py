"""
Agent-Ops Task Daemon
Maintains a permanent agent pool across all Claude Code reset windows.

Reads project.config.json (from same directory or CONFIG_FILE env var).
All project-specific values — pool definition, board IDs, reset windows,
commands — come from config, not hardcoded constants.

Pool behaviour:
  - Pool slots are defined entirely in config["pool"]
  - Running slots are NEVER re-spawned (dedup)
  - Slots are re-spawned when: limit_hit / completed / stale / unknown
  - ticket-bug-0 is always spawned (minimum 1 bugfix worker)
  - ticket-bug-1 only when bug issues actually exist
  - ticket-feat only when feature issues exist
  - merge only when PRs are open
"""
import os, re, time, json, subprocess, urllib.request
from datetime import datetime, timezone, timedelta

# ── Config loading ────────────────────────────────────────────────────────────

_CONFIG_PATH = os.environ.get(
    "CONFIG_FILE",
    os.path.join(os.path.dirname(__file__), "..", "project.config.json"),
)

def load_config() -> dict:
    path = os.path.abspath(_CONFIG_PATH)
    with open(path) as f:
        return json.load(f)

CFG = load_config()

PROJECT     = CFG["project"]
POOL_CFG    = CFG["pool"]           # dict of slot_id → {type, always, desc}
RESET_HOURS = CFG.get("reset_hours", [0, 5, 9, 14, 19])
TZ_OFFSET   = CFG.get("timezone_offset_hours", 8)
TECH        = CFG.get("tech", {})
DEPLOY      = CFG.get("deploy", {})

# Derived constants
PROJECT_NAME    = PROJECT["name"]
GH_REPO         = PROJECT["repo"]
WORKDIR         = PROJECT.get("workdir", os.environ.get("WORKDIR", "/workspace"))
BOARD_NUMBER    = PROJECT.get("board_number", 1)
BOARD_OWNER     = PROJECT.get("board_owner", GH_REPO.split("/")[0])
BOARD_ID        = PROJECT.get("board_id", "")
STATUS_FIELD_ID = PROJECT.get("status_field_id", "")
BOARD_COLUMNS   = PROJECT.get("board_columns", {})

HEALTH_SCRIPT   = TECH.get("health_script", "bash scripts/project-health.sh")
COLLAB_FILE     = TECH.get("collab_file", "tasks/agent-collab.md")

LOCAL_TZ    = timezone(timedelta(hours=TZ_OFFSET))

# Environment
TG_TOKEN    = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT     = int(os.environ["TELEGRAM_CHAT_ID"])
GH_TOKEN    = os.environ.get("GH_TOKEN", "")
CLAUDE_BIN  = os.environ.get("CLAUDE_BIN", "")
CLAUDE_FLAGS = os.environ.get("CLAUDE_FLAGS", "--dangerously-skip-permissions")

STATE_FILE    = "/state/agent-state.json"
REGISTRY_FILE = "/state/agent-registry.json"
TASK_LOG      = "/state/task-history.jsonl"

# Agent log idle thresholds
RUNNING_IDLE_SECS   = 5 * 60     # < 5 min   → still running
COMPLETED_IDLE_SECS = 60 * 60    # 5–60 min  → completed; >60 min → stale


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
    os.makedirs("/state", exist_ok=True)
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
            age = (datetime.now(LOCAL_TZ) - datetime.fromisoformat(entry["spawned_at"])).total_seconds()
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

    if re.search(r"(hit your limit|usage limit|limit.*reset|resets?\s*9\s*am|resets?\s*tomorrow)", tail):
        return "limit_hit"
    # Detect agent waiting for human approval (permission prompt)
    if any(p in tail for p in ["do you want to proceed", "allow tool", "(y/n)", "approve or deny", "press enter to"]):
        return "needs_input"
    if idle < RUNNING_IDLE_SECS:
        return "running"
    if idle < COMPLETED_IDLE_SECS:
        return "completed"
    return "stale"


def needs_spawn(slot_id: str) -> tuple:
    """Return (should_spawn: bool, reason: str)."""
    status = slot_status(slot_id)
    if status == "running":
        return False, "running — skip"
    if status == "needs_input":
        return False, "needs_input — waiting for human approval"
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
    log_file = f"/state/{slot_id}-{int(time.time())}.log"
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


# ── Agent coordination helpers ────────────────────────────────────────────────

def read_active_work() -> str:
    """Return the 'Active Work' section lines from agent-collab.md."""
    collab_path = os.path.join(WORKDIR, COLLAB_FILE)
    try:
        with open(collab_path) as f:
            content = f.read()
        # Extract lines between "## Active Work" and the next "##" section
        match = re.search(r"## Active Work\n(.*?)(?=\n## |\Z)", content, re.DOTALL)
        if match:
            lines = match.group(1).strip()
            return lines if lines else "none"
        return "none"
    except Exception:
        return "unavailable"


def flush_pending_reports():
    """Send any agent report files written to /state/*-report.txt via Telegram."""
    report_dir = "/state"
    try:
        for fname in os.listdir(report_dir):
            if fname.endswith("-report.txt"):
                fpath = os.path.join(report_dir, fname)
                try:
                    with open(fpath) as f:
                        text = f.read().strip()
                    if text:
                        tg_send(f"📋 Agent report [{fname}]:\n{text}")
                    os.remove(fpath)
                except Exception as e:
                    print(f"[flush_reports] {fname}: {e}", flush=True)
    except Exception:
        pass


# ── Prompt Builders ───────────────────────────────────────────────────────────

def prompt_ticket_bug(bug_issues, feat_issues, slot_index: int) -> str:
    """Bugfix worker — prioritises bugs, falls back to features if no bugs."""
    if bug_issues:
        targets   = bug_issues[slot_index * 2: slot_index * 2 + 2]
        issue_str = " | ".join(f"#{i['number']} [{i['title'][:35]}]" for i in targets)
        task_desc = f"BUG issues (priority): {issue_str}"
    elif feat_issues:
        targets   = feat_issues[:2]
        issue_str = " | ".join(f"#{i['number']} [{i['title'][:35]}]" for i in targets)
        task_desc = f"No bugs found — falling back to feature issues: {issue_str}"
    else:
        task_desc = f"No open issues found — run health check and report via Telegram."

    return (
        f"You are ticket-bug worker #{slot_index + 1} for {PROJECT_NAME} at {WORKDIR}. "
        f"export PATH=/opt/homebrew/bin:$PATH. "
        f"Priority: fix bugs before features. {task_desc}. "
        f"Rules: 1) Read {COLLAB_FILE} 2) gh pr list --state open before claiming "
        f"3) branch fix/issue-N or feat/issue-N 4) implement + tests + PR 5) update {COLLAB_FILE}. "
        f"Base branch: main."
    )


def prompt_ticket_feat(feat_issues, bug_issues) -> str:
    """Feature worker — only picks up features, defers to bug workers for bugs."""
    available = feat_issues[:3]
    if not available and not bug_issues:
        return None
    if not available:
        return None
    issue_str = " | ".join(f"#{i['number']} [{i['title'][:35]}]" for i in available)
    return (
        f"You are the feature ticket worker for {PROJECT_NAME} at {WORKDIR}. "
        f"export PATH=/opt/homebrew/bin:$PATH. "
        f"ONLY work on FEATURE issues (not bugs — those are handled by other workers). "
        f"Feature issues: {issue_str}. "
        f"Rules: 1) Read {COLLAB_FILE} 2) gh pr list --state open before claiming "
        f"3) branch feat/issue-N 4) implement + tests + PR 5) update {COLLAB_FILE}. "
        f"Base branch: main."
    )


def prompt_merge(feature_prs, dep_prs) -> str:
    """Unified PR/merge checker for all open PRs."""
    feat_list = " ".join(f"#{p['number']}" for p in feature_prs[:12])
    dep_list  = " ".join(f"#{p['number']}" for p in dep_prs[:20])
    parts = []
    if feat_list:
        parts.append(f"Feature PRs: {feat_list}")
    if dep_list:
        parts.append(f"Dep PRs: {dep_list}")
    if not parts:
        return None

    typecheck_cmd = TECH.get("typecheck_command", "pnpm run typecheck")
    pkg_mgr       = TECH.get("package_manager", "pnpm")

    return (
        f"You are the PR/merge checker for {PROJECT_NAME} at {WORKDIR}. "
        f"export PATH=/opt/homebrew/bin:$PATH. "
        f"{'. '.join(parts)}. "
        f"For each PR: gh pr checks → wait if pending → resolve conflicts "
        f"(keep main for CHANGELOG/{COLLAB_FILE.split('/')[-1]}, "
        f"{pkg_mgr} install for lockfile) → "
        f"run `{typecheck_cmd}` after conflict resolution (must pass before merge) → "
        f"MIGRATION CHECK: if PR touches shared/db/migrations/*.sql, verify the migration number "
        f"is reserved in the 'Migration Reservation' section of {COLLAB_FILE} and no other open "
        f"PR claims the same number — if conflict, close the older PR with a comment → "
        f"gh pr merge --squash --delete-branch. "
        f"Dep PRs: merge if minor/patch bump and CI green; close if major version bump. "
        f"Merge feature PRs first (highest risk), then deps. One at a time."
    )


def prompt_pm(bugs, feats, feature_prs, dep_prs) -> str:
    """Project manager — board sync, agent coordination, ticket prioritization."""
    bug_list      = " ".join(f"#{i['number']}" for i in bugs[:10])
    feat_list     = " ".join(f"#{i['number']}" for i in feats[:10])
    pr_list       = " ".join(f"#{p['number']}" for p in feature_prs[:8])
    active_work   = read_active_work()

    col = BOARD_COLUMNS
    done_col     = col.get("done", "")
    review_col   = col.get("review", "")
    todo_col     = col.get("todo", "")

    board_cmd = (
        f"gh project item-list {BOARD_NUMBER} --owner {BOARD_OWNER} --format json"
    )

    return (
        f"You are the Project Manager agent for {PROJECT_NAME} at {WORKDIR}. "
        f"export PATH=/opt/homebrew/bin:$PATH. "
        f"Your responsibilities this cycle:\n\n"

        f"1. BOARD SYNC — Update GitHub project board (project #{BOARD_NUMBER}, owner {BOARD_OWNER}):\n"
        f"   - {board_cmd}\n"
        f"   - Any issue with a merged PR → move to Done column (option-id: {done_col})\n"
        f"   - Any issue with an open PR → move to Review (option-id: {review_col})\n"
        f"   - Any 'In Progress' issue with NO recent commit in last 24h → move back to Todo (option-id: {todo_col})\n"
        f"   - Project-id: {BOARD_ID}, field-id: {STATUS_FIELD_ID}\n\n"

        f"2. TICKET PRIORITIZATION — Update labels and priority order:\n"
        f"   Current bugs: {bug_list or 'none'}\n"
        f"   Current features: {feat_list or 'none'}\n"
        f"   Currently active claims:\n{active_work}\n"
        f"   - Add 'bug' label to any issue with 'fix', 'error', 'crash', 'broken' in title\n"
        f"   - Add 'P1' label to any enhancement issue that closes a user-facing gap\n"
        f"   - Add 'P0' label to any production-breaking bug\n"
        f"   - Close duplicate issues (same topic, keep newest)\n"
        f"   - NEVER recommend tickets already listed in active claims above\n\n"

        f"3. AGENT COORDINATION — Read and update {COLLAB_FILE}:\n"
        f"   - Check 'Active Work' section for stale claims (branch not in open PRs = stale)\n"
        f"   - For stale claims: remove from Active Work, move to Recently Completed or re-open\n"
        f"   - Write a 'Next Recommended Tickets' section at the top of {COLLAB_FILE}:\n"
        f"     * List top 2 bugs for ticket-bug workers (by P0/P1 label, then creation date)\n"
        f"     * List top 1 feature for ticket-feat worker\n"
        f"   - Ensure no two active claims are for the same issue\n\n"

        f"4. PR COORDINATION — Check for duplicate PRs:\n"
        f"   Open feature PRs: {pr_list or 'none'}\n"
        f"   - If two PRs target the same issue → comment on the older one, close it as duplicate\n"
        f"   - If a PR has been open >48h with no review → add 'needs-review' label\n\n"

        f"5. REPORT — Write summary to /state/pm-report.txt (NOT via curl/Telegram — daemon will send it):\n"
        f"   echo 'PM REPORT: <board_changes> | <priority_updates> | <coordination_notes>' > /state/pm-report.txt\n"
        f"   Keep under 500 chars. Include counts: X board moves, Y label updates, Z stale claims cleared.\n\n"

        f"Be thorough but efficient. Do NOT implement any code — only manage coordination and labels."
    )


def prompt_health() -> str:
    return (
        f"Run {PROJECT_NAME} project health check at {WORKDIR}. "
        f"export PATH=/opt/homebrew/bin:$PATH. "
        f"1. {HEALTH_SCRIPT} 2>&1 | tail -20 "
        f"2. gh run list --limit 5 --json status,conclusion,headBranch "
        f"   --jq '.[] | \"\\(.headBranch[:25]): \\(.status)/\\(.conclusion)\"' "
        f"3. Write a summary (<400 chars) to /state/health-0-report.txt — "
        f"   the daemon will forward it to Telegram. Done."
    )


def prompt_monitor() -> str:
    deploy    = DEPLOY
    gateway   = deploy.get("gateway_url_env", "GATEWAY_URL")
    frontend  = deploy.get("frontend_url_env", "FRONTEND_URL")
    monitor_script = TECH.get("monitor_script", "bash scripts/deployment-monitor.sh")
    return (
        f"You are the deployment monitor for {PROJECT_NAME} at {WORKDIR}. "
        f"export PATH=/opt/homebrew/bin:$PATH. "
        f"Run the deployment monitor and investigate any failures:\n"
        f"1. {monitor_script} 2>&1\n"
        f"2. If any service failed: check recent CI runs — "
        f"   gh run list --limit 10 --json status,conclusion,headBranch,createdAt | jq .\n"
        f"3. For each failed service, check its Railway logs if RAILWAY_TOKEN is set:\n"
        f"   Look at the last deployment logs for crash signatures.\n"
        f"4. If a crash is identified and fixable (config error, missing env var, OOM): "
        f"   open a GitHub issue labelled 'bug P0' with title 'CRASH: <service> - <reason>' "
        f"   and assign it to the bug worker queue.\n"
        f"5. Write a Telegram summary (under 500 chars) to /state/monitor-0-report.txt — "
        f"   format: 'MONITOR: X/Y services healthy | issues found | actions taken'\n"
        f"   The daemon will forward it to Telegram.\n"
        f"Do NOT push any code — only investigate, report, and open issues."
    )


def build_prompt(slot_id: str, slot_type: str, slot_index: int,
                 bugs, feats, feature_prs, dep_prs):
    """Dispatch to the right prompt builder based on slot type."""
    if slot_type == "pm":
        return prompt_pm(bugs, feats, feature_prs, dep_prs)
    elif slot_type == "ticket-bug":
        return prompt_ticket_bug(bugs, feats, slot_index)
    elif slot_type == "ticket-feat":
        return prompt_ticket_feat(feats, bugs)
    elif slot_type == "merge":
        return prompt_merge(feature_prs, dep_prs)
    elif slot_type == "health":
        return prompt_health()
    elif slot_type == "monitor":
        return prompt_monitor()
    else:
        # Custom slot type: build a generic prompt
        return (
            f"You are the {slot_id} agent for {PROJECT_NAME} at {WORKDIR}. "
            f"export PATH=/opt/homebrew/bin:$PATH. "
            f"Read {COLLAB_FILE} before starting. Claim your work, do it, update the file."
        )


# ── Pool Manager ──────────────────────────────────────────────────────────────

def manage_pool():
    """Evaluate every slot in POOL_CFG and spawn/skip as needed."""
    # Forward any agent report files written during the previous cycle
    flush_pending_reports()

    bugs, feats, feature_prs, dep_prs = fetch_work()

    # Persist snapshot
    os.makedirs("/state", exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump({
            "updated_at":   _now(),
            "bug_issues":   [{"number": i["number"], "title": i["title"]} for i in bugs],
            "feat_issues":  [{"number": i["number"], "title": i["title"]} for i in feats],
            "feature_prs":  [{"number": p["number"], "title": p["title"]} for p in feature_prs],
            "dep_prs":      [{"number": p["number"], "title": p["title"]} for p in dep_prs],
        }, f, indent=2)

    now_str = datetime.now(LOCAL_TZ).strftime("%Y-%m-%d %H:%M")
    tg_send(
        f"⏰ {now_str} — reset window\n"
        f"🐛 {len(bugs)} bugs  ✨ {len(feats)} features  "
        f"📋 {len(feature_prs)} feat PRs  📦 {len(dep_prs)} dep PRs"
    )

    claude_ok = bool(CLAUDE_BIN and os.path.isfile(CLAUDE_BIN))
    results   = []

    for slot_id, cfg in POOL_CFG.items():
        slot_type  = cfg["type"]
        desc       = cfg.get("desc", slot_type)

        # Determine if there's work for this slot type
        has_work = {
            "pm":          True,
            "ticket-bug":  bool(bugs or feats),
            "ticket-feat": bool(feats),
            "merge":       bool(feature_prs or dep_prs),
            "health":      True,
            "monitor":     True,
        }.get(slot_type, True)  # unknown types always have work

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

        # Parse slot index from the trailing digit
        try:
            slot_index = int(slot_id.rsplit("-", 1)[-1])
        except ValueError:
            slot_index = 0

        p = build_prompt(slot_id, slot_type, slot_index, bugs, feats, feature_prs, dep_prs)

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
    # Alert for any slot waiting for human input
    blocked = [r for r in results if "needs_input" in r]
    if blocked:
        tg_send("🔔 Agent blocked — waiting for human approval:\n" + "\n".join(blocked))


# ── Scheduler ─────────────────────────────────────────────────────────────────

def seconds_until_next_reset():
    now  = datetime.now(LOCAL_TZ)
    base = now.replace(second=0, microsecond=0)
    candidates = [
        base.replace(hour=h, minute=1)
        for h in RESET_HOURS
        if base.replace(hour=h, minute=1) > now
    ]
    if not candidates:
        nxt = (base + timedelta(days=1)).replace(hour=RESET_HOURS[0], minute=1)
    else:
        nxt = min(candidates)
    return (nxt - now).total_seconds(), nxt


def _now() -> str:
    return datetime.now(LOCAL_TZ).isoformat()


def _log(event: str, detail: str = ""):
    os.makedirs("/state", exist_ok=True)
    with open(TASK_LOG, "a") as f:
        f.write(json.dumps({"ts": _now(), "event": event, "detail": detail}) + "\n")
    print(f"[{event}] {detail}", flush=True)


# ── Entry Point ───────────────────────────────────────────────────────────────

def main():
    os.makedirs("/state", exist_ok=True)
    reset_str = " | ".join(f"{h:02d}:00" for h in RESET_HOURS)
    claude_ok = bool(CLAUDE_BIN and os.path.isfile(CLAUDE_BIN))

    pool_lines = "\n".join(
        f"  {sid}: {cfg.get('desc', cfg['type'])}"
        for sid, cfg in POOL_CFG.items()
    )
    print(f"[daemon] started — project={PROJECT_NAME} resets={reset_str}", flush=True)
    tg_send(
        f"🤖 {PROJECT_NAME} Task Daemon\n"
        f"Repo: {GH_REPO}\n"
        f"Resets (UTC+{TZ_OFFSET}): {reset_str}\n\n"
        f"Agent pool:\n{pool_lines}\n\n"
        f"Rules: bugs > features | dedup running slots\n"
        f"Claude CLI: {'✅ mounted' if claude_ok else '⚠️  not mounted (notify-only)'}"
    )

    bugs, feats, fp, dp = fetch_work()
    _log("startup", f"{len(bugs)} bugs, {len(feats)} feats, {len(fp)} feat PRs, {len(dp)} dep PRs")

    last_hour = -1
    while True:
        wait, nxt = seconds_until_next_reset()
        print(
            f"[daemon] {datetime.now(LOCAL_TZ).strftime('%H:%M:%S')} — "
            f"next reset {nxt.strftime('%H:%M')} UTC+{TZ_OFFSET} (in {wait/3600:.2f}h)",
            flush=True,
        )
        time.sleep(wait)

        cur_hour = datetime.now(LOCAL_TZ).hour
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
