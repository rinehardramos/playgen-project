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
import os, time, json, subprocess, urllib.request
from datetime import datetime, timezone, timedelta

MANILA        = timezone(timedelta(hours=8))
TG_TOKEN      = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT       = int(os.environ["TELEGRAM_CHAT_ID"])
GH_TOKEN      = os.environ.get("GH_TOKEN", "")
GH_REPO       = os.environ.get("GH_REPO", "rinehardramos/playgen-project")
WORKDIR       = os.environ.get("WORKDIR", "/workspace")
CLAUDE_BIN    = os.environ.get("CLAUDE_BIN", "")
CLAUDE_FLAGS  = os.environ.get("CLAUDE_FLAGS", "--dangerously-skip-permissions")

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


def prompt_pm(bugs, feats, feature_prs, dep_prs):
    """Project manager — board sync, agent coordination, ticket prioritization."""
    bug_list   = " ".join(f"#{i['number']}" for i in bugs[:10])
    feat_list  = " ".join(f"#{i['number']}" for i in feats[:10])
    pr_list    = " ".join(f"#{p['number']}" for p in feature_prs[:8])

    return (
        f"You are the Project Manager agent for PlayGen at /workspace. "
        f"export PATH=/opt/homebrew/bin:$PATH. "
        f"Your responsibilities this cycle:\n\n"

        f"1. BOARD SYNC — Update GitHub project board (project #2, owner rinehardramos):\n"
        f"   - gh project item-list 2 --owner rinehardramos --format json\n"
        f"   - Any issue with a merged PR → move to Done column (option-id: c2007256)\n"
        f"   - Any issue with an open PR → move to Review (option-id: 22fda963)\n"
        f"   - Any 'In Progress' issue with NO recent commit in last 24h → move back to Todo (option-id: 00c6ca1e)\n"
        f"   - Project-id: PVT_kwHOAXQAu84BTrFP, field-id: PVTSSF_lAHOAXQAu84BTrFPzhA4e9s\n\n"

        f"2. TICKET PRIORITIZATION — Update labels and priority order:\n"
        f"   Current bugs: {bug_list or 'none'}\n"
        f"   Current features: {feat_list or 'none'}\n"
        f"   - Add 'bug' label to any issue with 'fix', 'error', 'crash', 'broken' in title\n"
        f"   - Add 'P1' label to any enhancement issue that closes a user-facing gap\n"
        f"   - Add 'P0' label to any production-breaking bug\n"
        f"   - Close duplicate issues (same topic, keep newest)\n\n"

        f"3. AGENT COORDINATION — Read and update tasks/agent-collab.md:\n"
        f"   - Check 'Active Work' section for stale claims (>24h with no PR)\n"
        f"   - For stale claims: remove from Active Work, move to Recently Completed or re-open\n"
        f"   - Write a 'Next Recommended Tickets' section at the top of agent-collab.md:\n"
        f"     * List top 2 bugs for ticket-bug workers (by P0/P1 label, then creation date)\n"
        f"     * List top 1 feature for ticket-feat worker\n"
        f"   - Ensure no two active claims are for the same issue\n\n"

        f"4. PR COORDINATION — Check for duplicate PRs:\n"
        f"   Open feature PRs: {pr_list or 'none'}\n"
        f"   - If two PRs target the same issue → comment on the older one, close it as duplicate\n"
        f"   - If a PR has been open >48h with no review → add 'needs-review' label\n\n"

        f"5. REPORT — Send a summary to Telegram:\n"
        f"   curl -s -X POST 'https://api.telegram.org/bot{TG_TOKEN}/sendMessage' \\\n"
        f"   -H 'Content-Type: application/json' \\\n"
        f"   -d '{{\"chat_id\":\"{TG_CHAT}\",\"text\":\"PM REPORT: board_changes | priority_updates | coordination_notes\"}}'\n"
        f"   Keep under 500 chars. Include counts: X board moves, Y label updates, Z stale claims cleared.\n\n"

        f"Be thorough but efficient. Do NOT implement any code — only manage coordination and labels."
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
            p = prompt_pm(bugs, feats, feature_prs, dep_prs)
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
    tg_send(
        f"🤖 PlayGen Task Daemon v4\n"
        f"Resets (Manila): {reset_str}\n\n"
        f"Agent pool:\n{pool_lines}\n\n"
        f"Rules: bugs > features | 2 bug workers | 1 feat | 1 merge | 1 health\n"
        f"Dedup: running slots are never re-spawned\n"
        f"Claude CLI: {'✅ mounted' if claude_ok else '⚠️  not mounted (notify-only)'}"
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
