"""
Shared fixtures for task-daemon tests.
Patches environment variables so daemon.py can be imported without
real credentials, and provides tmp_state + registry helpers.
"""
import os
import json
import time
import pytest

# ── Set defaults BEFORE any test module imports daemon ───────────────────────
# daemon.py reads env vars at module level, so these must be set at conftest
# load time (collection phase), not just inside fixtures.
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("TELEGRAM_CHAT_ID", "-999")
os.environ.setdefault("GH_TOKEN", "test-gh-token")
os.environ.setdefault("GH_REPO", "test-owner/test-repo")
os.environ.setdefault("WORKDIR", "/tmp/test-workspace")
os.environ.setdefault("CLAUDE_BIN", "")


# ── Patch env before any daemon import ───────────────────────────────────────

@pytest.fixture(autouse=True)
def daemon_env(tmp_path, monkeypatch):
    """Set all required env vars and redirect state files to tmp_path."""
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test-token")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "-999")
    monkeypatch.setenv("GH_TOKEN", "test-gh-token")
    monkeypatch.setenv("GH_REPO", "test-owner/test-repo")
    monkeypatch.setenv("WORKDIR", str(tmp_path / "workspace"))
    monkeypatch.setenv("CLAUDE_BIN", "")

    state_dir = tmp_path / "state"
    state_dir.mkdir()

    # PLAYGEN_STATE_DIR is now the single env var that controls all state paths
    monkeypatch.setenv("PLAYGEN_STATE_DIR", str(state_dir))

    import daemon
    # Also patch the already-evaluated module-level paths so tests that import
    # daemon before the fixture runs get the correct paths.
    monkeypatch.setattr(daemon, "STATE_FILE",    str(state_dir / "agent-state.json"))
    monkeypatch.setattr(daemon, "REGISTRY_FILE", str(state_dir / "agent-registry.json"))
    monkeypatch.setattr(daemon, "TASK_LOG",      str(state_dir / "task-history.jsonl"))
    return state_dir


# ── Registry helpers ──────────────────────────────────────────────────────────

@pytest.fixture
def write_registry(daemon_env):
    """Factory: write an agent-registry.json entry."""
    import daemon as d

    def _write(slot_id: str, log_content: str = "", idle_secs: int = 0,
               spawned_secs_ago: int = 10):
        log_file = str(daemon_env / f"{slot_id}.log")
        with open(log_file, "w") as f:
            f.write(log_content)
        # Set mtime to simulate idle time
        mtime = time.time() - idle_secs
        os.utime(log_file, (mtime, mtime))

        reg = d.load_registry()
        from datetime import datetime, timezone, timedelta
        MANILA = timezone(timedelta(hours=8))
        spawned_at = (datetime.now(MANILA) -
                      timedelta(seconds=spawned_secs_ago)).isoformat()
        reg[slot_id] = {"log_file": log_file, "spawned_at": spawned_at}
        d.save_registry(reg)
        return log_file

    return _write
