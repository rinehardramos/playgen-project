"""
Agent-Ops Telegram Bot
Command interface for project health, CI status, PR management.

Reads project.config.json (from parent directory or CONFIG_FILE env var).
All project-specific values come from config.
"""
import subprocess
import json
import time
import os
import urllib.request
import urllib.parse

# ── Config loading ────────────────────────────────────────────────────────────

_CONFIG_PATH = os.environ.get(
    "CONFIG_FILE",
    os.path.join(os.path.dirname(__file__), "..", "project.config.json"),
)

def load_config() -> dict:
    path = os.path.abspath(_CONFIG_PATH)
    with open(path) as f:
        return json.load(f)

CFG          = load_config()
PROJECT_NAME = CFG["project"]["name"]
WORKDIR      = CFG["project"].get("workdir", os.environ.get("WORKDIR", "/workspace"))
TECH         = CFG.get("tech", {})
HEALTH_SCRIPT = TECH.get("health_script", "bash scripts/project-health.sh")

# ── Telegram setup ────────────────────────────────────────────────────────────

TOKEN    = os.environ["TELEGRAM_BOT_TOKEN"]
CHAT_ID  = int(os.environ["TELEGRAM_CHAT_ID"])
BASE_URL = f"https://api.telegram.org/bot{TOKEN}"


def tg_get(endpoint, params=None):
    url = f"{BASE_URL}/{endpoint}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=35) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"GET error: {e}", flush=True)
        return {"ok": False, "result": []}


def tg_send(text):
    url  = f"{BASE_URL}/sendMessage"
    data = json.dumps({"chat_id": CHAT_ID, "text": text[:4000]}).encode()
    req  = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"Send error: {e}", flush=True)


def run(cmd):
    env = os.environ.copy()
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            cwd=WORKDIR, env=env, timeout=30
        )
        return (result.stdout + result.stderr).strip()
    except subprocess.TimeoutExpired:
        return "Command timed out"
    except Exception as e:
        return str(e)


# ── Command Handlers ──────────────────────────────────────────────────────────

def handle(text: str):
    text = text.strip()

    if text == "/help":
        return (
            f"Available commands for {PROJECT_NAME}:\n"
            "/status — CI + open PRs overview\n"
            "/health — project health check\n"
            "/prs — list open feature PRs\n"
            "/ci — last 5 CI runs\n"
            "/issues — open bugs and features\n"
            "/pool — daemon pool status\n"
            "/merge <pr_num> — squash-merge a PR\n"
            "/help — this message"
        )

    elif text == "/status":
        prs = run(
            "gh pr list --state open --json number,title "
            "--jq '.[] | select(.title | test(\"feat|fix\"; \"i\")) "
            "| \"#\\(.number) \\(.title[:45])\"' | head -8"
        )
        ci = run(
            "gh run list --limit 4 --json status,conclusion,headBranch "
            "--jq '.[] | \"\\(.headBranch[:28]): \\(.status)/\\(.conclusion)\"'"
        )
        return f"📊 {PROJECT_NAME} Status\n\nOpen PRs:\n{prs or 'none'}\n\nCI (last 4):\n{ci or 'no runs'}"

    elif text == "/health":
        out = run(f"{HEALTH_SCRIPT} 2>&1 | tail -25")
        return f"🏥 Health:\n{out[:1500]}"

    elif text == "/prs":
        out = run(
            "gh pr list --state open --json number,title "
            "--jq '.[] | select(.title | test(\"feat|fix\"; \"i\")) "
            "| \"#\\(.number) \\(.title[:50])\"'"
        )
        return f"📬 Open PRs:\n{out[:1500] or 'none'}"

    elif text == "/ci":
        out = run(
            "gh run list --limit 5 --json status,conclusion,headBranch "
            "--jq '.[] | \"\\(.headBranch[:30]): \\(.status)/\\(.conclusion)\"'"
        )
        return f"🚦 CI Runs:\n{out or 'no runs'}"

    elif text == "/issues":
        bugs = run(
            "gh issue list --state open --label bug --json number,title "
            "--jq '.[] | \"🐛 #\\(.number) \\(.title[:50])\"' | head -10"
        )
        feats = run(
            "gh issue list --state open --json number,title,labels "
            "--jq '.[] | select(any(.labels[]; .name == \"bug\") | not) "
            "| \"✨ #\\(.number) \\(.title[:50])\"' | head -10"
        )
        return f"📋 Open Issues:\n\nBugs:\n{bugs or 'none'}\n\nFeatures:\n{feats or 'none'}"

    elif text == "/pool":
        # Read pool status from state file
        state_file = "/state/agent-state.json"
        registry_file = "/state/agent-registry.json"
        if os.path.exists(state_file):
            try:
                with open(state_file) as f:
                    state = json.load(f)
                updated = state.get("updated_at", "unknown")
                bugs    = len(state.get("bug_issues", []))
                feats   = len(state.get("feat_issues", []))
                fprs    = len(state.get("feature_prs", []))
                dprs    = len(state.get("dep_prs", []))
                info = (
                    f"Last cycle: {updated}\n"
                    f"Bugs: {bugs} | Features: {feats} | Feature PRs: {fprs} | Dep PRs: {dprs}"
                )
            except Exception as e:
                info = f"Error reading state: {e}"
        else:
            info = "State file not found — daemon may not have run yet."

        registry_info = ""
        if os.path.exists(registry_file):
            try:
                with open(registry_file) as f:
                    reg = json.load(f)
                lines = []
                for slot_id, entry in reg.items():
                    spawned = entry.get("spawned_at", "?")[:16]
                    log = entry.get("log_file", "?").split("/")[-1]
                    lines.append(f"  {slot_id}: {spawned} ({log})")
                registry_info = "\n\nSpawned slots:\n" + "\n".join(lines)
            except Exception as e:
                registry_info = f"\nRegistry read error: {e}"

        return f"🤖 Pool Status:\n{info}{registry_info}"

    elif text.startswith("/merge "):
        parts = text.split()
        if len(parts) != 2 or not parts[1].isdigit():
            return "Usage: /merge <pr_number>"
        pr  = parts[1]
        out = run(f"gh pr merge {pr} --squash --delete-branch 2>&1")
        return f"🔀 Merge #{pr}:\n{out[:400]}"

    return None


# ── Main loop ─────────────────────────────────────────────────────────────────

def main():
    offset = 0
    print(f"🟢 {PROJECT_NAME} Telegram bot polling started", flush=True)
    tg_send(
        f"🟢 {PROJECT_NAME} bot online.\n"
        f"Commands: /status /health /prs /ci /issues /pool /merge <pr> /help"
    )

    while True:
        resp = tg_get("getUpdates", {
            "timeout": 25,
            "offset": offset,
            "allowed_updates": ["message"],
        })
        if not resp.get("ok"):
            time.sleep(5)
            continue

        for update in resp.get("result", []):
            offset = update["update_id"] + 1
            msg = update.get("message", {})
            if msg.get("chat", {}).get("id") != CHAT_ID:
                continue
            text = msg.get("text", "")
            if not text.startswith("/"):
                continue
            print(f"Command: {text}", flush=True)
            reply = handle(text)
            if reply:
                tg_send(reply)


if __name__ == "__main__":
    main()
