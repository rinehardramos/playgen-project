"""
Unit tests for playgen-task-daemon logic.
All external I/O (GitHub API, Telegram, subprocess) is mocked.
"""
import os
import sys
import time
import json
import pytest
from unittest.mock import patch, MagicMock
from freezegun import freeze_time
from datetime import datetime, timezone, timedelta

# daemon.py lives one level up
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import daemon


MANILA = timezone(timedelta(hours=8))


# ═══════════════════════════════════════════════════════════════════════════════
# slot_status()
# ═══════════════════════════════════════════════════════════════════════════════

class TestSlotStatus:

    def test_unknown_when_no_registry_entry(self):
        assert daemon.slot_status("ticket-bug-0") == "unknown"

    def test_running_when_recently_spawned_no_log(self, write_registry):
        """Slot spawned 30s ago with no log file yet → running."""
        import daemon as d
        reg = d.load_registry()
        from datetime import datetime, timezone, timedelta
        reg["ticket-bug-0"] = {
            "spawned_at": datetime.now(MANILA).isoformat(),
            "log_file": "/nonexistent/path.log",
        }
        d.save_registry(reg)
        assert daemon.slot_status("ticket-bug-0") == "running"

    def test_running_when_log_recently_modified(self, write_registry):
        write_registry("ticket-bug-0", log_content="processing...", idle_secs=30)
        assert daemon.slot_status("ticket-bug-0") == "running"

    def test_limit_hit_detected_in_log_tail(self, write_registry):
        write_registry(
            "ticket-bug-0",
            log_content="some output\nYou've hit your limit · resets 9am (Asia/Manila)\n",
            idle_secs=400,
        )
        assert daemon.slot_status("ticket-bug-0") == "limit_hit"

    def test_limit_hit_case_insensitive(self, write_registry):
        write_registry(
            "merge-0",
            log_content="HIT YOUR LIMIT reached\n",
            idle_secs=600,
        )
        assert daemon.slot_status("merge-0") == "limit_hit"

    def test_completed_when_idle_5_to_60_min(self, write_registry):
        write_registry("health-0", log_content="done\n", idle_secs=20 * 60)  # 20 min
        assert daemon.slot_status("health-0") == "completed"

    def test_stale_when_idle_over_60_min(self, write_registry):
        write_registry("ticket-feat-0", log_content="done\n", idle_secs=90 * 60)  # 90 min
        assert daemon.slot_status("ticket-feat-0") == "stale"

    def test_running_beats_limit_msg_if_recent(self, write_registry):
        """If log was modified <5 min ago, even with limit msg in middle, check tail only."""
        # Tail has no limit msg — recent activity after the limit message
        content = "hit your limit\n" + "resuming work...\n" * 20
        write_registry("pm-0", log_content=content, idle_secs=60)
        # idle < 5 min → running (tail check is last 600 bytes)
        assert daemon.slot_status("pm-0") == "running"


# ═══════════════════════════════════════════════════════════════════════════════
# needs_spawn()
# ═══════════════════════════════════════════════════════════════════════════════

class TestNeedsSpawn:

    def test_skip_running_slot(self, write_registry):
        write_registry("ticket-bug-0", log_content="running", idle_secs=10)
        should, reason = daemon.needs_spawn("ticket-bug-0")
        assert should is False
        assert "running" in reason

    def test_respawn_limit_hit(self, write_registry):
        write_registry("ticket-bug-0",
                       log_content="hit your limit\n", idle_secs=400)
        should, reason = daemon.needs_spawn("ticket-bug-0")
        assert should is True
        assert "limit_hit" in reason

    def test_respawn_completed(self, write_registry):
        write_registry("merge-0", log_content="done\n", idle_secs=20 * 60)
        should, reason = daemon.needs_spawn("merge-0")
        assert should is True
        assert "completed" in reason

    def test_respawn_stale(self, write_registry):
        write_registry("health-0", log_content="done\n", idle_secs=90 * 60)
        should, reason = daemon.needs_spawn("health-0")
        assert should is True
        assert "stale" in reason

    def test_spawn_fresh_unknown(self):
        should, reason = daemon.needs_spawn("pm-0")
        assert should is True
        assert "unknown" in reason


# ═══════════════════════════════════════════════════════════════════════════════
# seconds_until_next_reset()
# ═══════════════════════════════════════════════════════════════════════════════

class TestResetSchedule:

    @freeze_time("2026-04-05 07:30:00+08:00")
    def test_next_reset_is_9am_from_730am(self):
        secs, nxt = daemon.seconds_until_next_reset()
        assert nxt.hour == 9
        assert nxt.minute == 1
        assert 90 * 60 < secs < 92 * 60   # ~91 min

    @freeze_time("2026-04-05 09:30:00+08:00")
    def test_next_reset_is_14_from_930am(self):
        secs, nxt = daemon.seconds_until_next_reset()
        assert nxt.hour == 14

    @freeze_time("2026-04-05 20:00:00+08:00")
    def test_next_reset_wraps_to_midnight(self):
        secs, nxt = daemon.seconds_until_next_reset()
        assert nxt.hour == 0   # next day midnight

    @freeze_time("2026-04-05 00:05:00+08:00")
    def test_next_reset_is_5am_from_just_past_midnight(self):
        """After the midnight reset fires (00:01), next window is 05:00."""
        secs, nxt = daemon.seconds_until_next_reset()
        assert nxt.hour == 5

    def test_all_reset_hours_covered(self):
        """Exactly 5 reset windows defined."""
        assert len(daemon.RESET_HOURS) == 5
        assert daemon.RESET_HOURS == [0, 5, 9, 14, 19]


# ═══════════════════════════════════════════════════════════════════════════════
# _is_bug() / _is_dep()
# ═══════════════════════════════════════════════════════════════════════════════

class TestIssueClassifiers:

    @pytest.mark.parametrize("labels,expected", [
        ([{"name": "bug"}], True),
        ([{"name": "P0"}], True),
        ([{"name": "hotfix"}], True),
        ([{"name": "critical"}], True),
        ([{"name": "enhancement"}], False),
        ([{"name": "feature"}], False),
        ([], False),
    ])
    def test_is_bug(self, labels, expected):
        issue = {"labels": labels, "title": "some issue"}
        assert daemon._is_bug(issue) == expected

    @pytest.mark.parametrize("login,title,expected", [
        ("dependabot[bot]", "bump lodash", True),
        ("dependabot[bot]", "chore(deps): bump react", True),
        ("human-dev",       "bump lodash from 1 to 2", True),
        ("human-dev",       "chore(deps): update deps", True),
        ("human-dev",       "feat: add new feature", False),
        ("human-dev",       "fix: resolve bug", False),
    ])
    def test_is_dep(self, login, title, expected):
        item = {"user": {"login": login}, "title": title}
        assert daemon._is_dep(item) == expected


# ═══════════════════════════════════════════════════════════════════════════════
# Pool slot conditions (manage_pool logic)
# ═══════════════════════════════════════════════════════════════════════════════

class TestPoolConditions:

    def _make_issue(self, number, title, labels=None):
        return {"number": number, "title": title,
                "labels": [{"name": l} for l in (labels or [])],
                "pull_request": None}

    def test_ticket_bug_1_skipped_when_no_bugs(self, monkeypatch, write_registry):
        """ticket-bug-1 must not spawn when there are no bug issues."""
        bugs, feats = [], [self._make_issue(1, "feat: something", ["enhancement"])]
        fprs, dprs  = [], []

        spawned = []
        monkeypatch.setattr(daemon, "fetch_work", lambda: (bugs, feats, fprs, dprs))
        monkeypatch.setattr(daemon, "tg_send", lambda *a, **k: None)
        monkeypatch.setattr(daemon, "spawn", lambda slot_id, _prompt: spawned.append(slot_id) or True)
        monkeypatch.setattr(daemon, "CLAUDE_BIN", "/fake/claude")
        monkeypatch.setattr(os.path, "isfile", lambda p: p == "/fake/claude")

        daemon.manage_pool()
        assert "ticket-bug-1" not in spawned

    def test_ticket_bug_0_spawns_even_with_no_bugs(self, monkeypatch, write_registry):
        """ticket-bug-0 always spawns (min 1 bug worker)."""
        bugs, feats = [], [self._make_issue(1, "feat: add thing", ["enhancement"])]
        fprs, dprs  = [], []

        spawned = []
        monkeypatch.setattr(daemon, "fetch_work", lambda: (bugs, feats, fprs, dprs))
        monkeypatch.setattr(daemon, "tg_send", lambda *a, **k: None)
        monkeypatch.setattr(daemon, "spawn", lambda sid, _p: spawned.append(sid) or True)
        monkeypatch.setattr(daemon, "CLAUDE_BIN", "/fake/claude")
        monkeypatch.setattr(os.path, "isfile", lambda p: p == "/fake/claude")

        daemon.manage_pool()
        assert "ticket-bug-0" in spawned

    def test_ticket_bug_1_spawns_when_bugs_exist(self, monkeypatch):
        bugs = [self._make_issue(1, "fix: crash on login", ["bug"])]
        feats, fprs, dprs = [], [], []

        spawned = []
        monkeypatch.setattr(daemon, "fetch_work", lambda: (bugs, feats, fprs, dprs))
        monkeypatch.setattr(daemon, "tg_send", lambda *a, **k: None)
        monkeypatch.setattr(daemon, "spawn", lambda sid, _p: spawned.append(sid) or True)
        monkeypatch.setattr(daemon, "CLAUDE_BIN", "/fake/claude")
        monkeypatch.setattr(os.path, "isfile", lambda p: p == "/fake/claude")

        daemon.manage_pool()
        assert "ticket-bug-1" in spawned

    def test_merge_skipped_when_no_prs(self, monkeypatch):
        bugs, feats, fprs, dprs = [], [], [], []

        spawned = []
        monkeypatch.setattr(daemon, "fetch_work", lambda: (bugs, feats, fprs, dprs))
        monkeypatch.setattr(daemon, "tg_send", lambda *a, **k: None)
        monkeypatch.setattr(daemon, "spawn", lambda sid, _p: spawned.append(sid) or True)
        monkeypatch.setattr(daemon, "CLAUDE_BIN", "/fake/claude")
        monkeypatch.setattr(os.path, "isfile", lambda p: p == "/fake/claude")

        daemon.manage_pool()
        assert "merge-0" not in spawned

    def test_running_slot_not_respawned(self, monkeypatch, write_registry):
        """A running health-0 must not be spawned again."""
        write_registry("health-0", log_content="working...", idle_secs=10)
        bugs, feats, fprs, dprs = [], [], [], []

        spawned = []
        monkeypatch.setattr(daemon, "fetch_work", lambda: (bugs, feats, fprs, dprs))
        monkeypatch.setattr(daemon, "tg_send", lambda *a, **k: None)
        monkeypatch.setattr(daemon, "spawn", lambda sid, _p: spawned.append(sid) or True)
        monkeypatch.setattr(daemon, "CLAUDE_BIN", "/fake/claude")
        monkeypatch.setattr(os.path, "isfile", lambda p: p == "/fake/claude")

        daemon.manage_pool()
        assert "health-0" not in spawned

    def test_limit_hit_slot_is_respawned(self, monkeypatch, write_registry):
        """A limit-hit health-0 must be re-spawned."""
        write_registry("health-0",
                       log_content="output\nhit your limit\n", idle_secs=400)
        bugs, feats, fprs, dprs = [], [], [], []

        spawned = []
        monkeypatch.setattr(daemon, "fetch_work", lambda: (bugs, feats, fprs, dprs))
        monkeypatch.setattr(daemon, "tg_send", lambda *a, **k: None)
        monkeypatch.setattr(daemon, "spawn", lambda sid, _p: spawned.append(sid) or True)
        monkeypatch.setattr(daemon, "CLAUDE_BIN", "/fake/claude")
        monkeypatch.setattr(os.path, "isfile", lambda p: p == "/fake/claude")

        daemon.manage_pool()
        assert "health-0" in spawned

    def test_pm_always_spawns(self, monkeypatch):
        """pm-0 spawns regardless of work availability."""
        bugs, feats, fprs, dprs = [], [], [], []

        spawned = []
        monkeypatch.setattr(daemon, "fetch_work", lambda: (bugs, feats, fprs, dprs))
        monkeypatch.setattr(daemon, "tg_send", lambda *a, **k: None)
        monkeypatch.setattr(daemon, "spawn", lambda sid, _p: spawned.append(sid) or True)
        monkeypatch.setattr(daemon, "CLAUDE_BIN", "/fake/claude")
        monkeypatch.setattr(os.path, "isfile", lambda p: p == "/fake/claude")

        daemon.manage_pool()
        assert "pm-0" in spawned


# ═══════════════════════════════════════════════════════════════════════════════
# Registry persistence
# ═══════════════════════════════════════════════════════════════════════════════

class TestRegistry:

    def test_save_and_load_roundtrip(self):
        reg = {"ticket-bug-0": {"log_file": "/state/x.log", "spawned_at": "2026-01-01"}}
        daemon.save_registry(reg)
        loaded = daemon.load_registry()
        assert loaded == reg

    def test_load_returns_empty_dict_when_missing(self, tmp_path, monkeypatch):
        monkeypatch.setattr(daemon, "REGISTRY_FILE", str(tmp_path / "missing.json"))
        assert daemon.load_registry() == {}

    def test_spawn_writes_registry_entry(self, tmp_path, monkeypatch):
        fake_bin = str(tmp_path / "claude")
        workdir  = str(tmp_path / "workspace")
        os.makedirs(workdir, exist_ok=True)
        with open(fake_bin, "w") as f:
            f.write("#!/bin/sh\nsleep 999\n")
        os.chmod(fake_bin, 0o755)

        monkeypatch.setattr(daemon, "CLAUDE_BIN", fake_bin)
        monkeypatch.setattr(daemon, "WORKDIR", workdir)
        monkeypatch.setattr(daemon, "CLAUDE_FLAGS", "")

        launched = daemon.spawn("test-slot", "echo hello")
        assert launched is True

        reg = daemon.load_registry()
        assert "test-slot" in reg
        assert os.path.exists(reg["test-slot"]["log_file"])


# ═══════════════════════════════════════════════════════════════════════════════
# Prompt builders — smoke tests (not empty, contain key strings)
# ═══════════════════════════════════════════════════════════════════════════════

class TestPromptBuilders:

    def _issue(self, n, title, labels=None):
        return {"number": n, "title": title,
                "labels": [{"name": l} for l in (labels or [])]}

    def _pr(self, n, title):
        return {"number": n, "title": title, "user": {"login": "dev"}}

    def test_prompt_ticket_bug_with_bugs(self):
        bugs  = [self._issue(1, "fix: login crash", ["bug"])]
        feats = []
        p = daemon.prompt_ticket_bug(bugs, feats, slot_index=0)
        assert "BUG" in p
        assert "#1" in p
        assert "export PATH" in p

    def test_prompt_ticket_bug_fallback_to_feats(self):
        p = daemon.prompt_ticket_bug([], [self._issue(2, "feat: X", [])], slot_index=0)
        assert "falling back" in p.lower() or "feature" in p.lower()

    def test_prompt_ticket_feat_returns_none_when_no_feats(self):
        assert daemon.prompt_ticket_feat([], []) is None

    def test_prompt_merge_returns_none_when_no_prs(self):
        assert daemon.prompt_merge([], []) is None

    def test_prompt_merge_includes_both_pr_types(self):
        fp = [self._pr(10, "feat: x")]
        dp = [self._pr(66, "chore(deps): bump react")]
        p = daemon.prompt_merge(fp, dp)
        assert "#10" in p
        assert "#66" in p

    def test_prompt_pm_board_sync_includes_board_ids(self):
        p = daemon.prompt_pm([], [], [], [], mode="board_sync")
        assert "PVT_kwHOAXQAu84BTrFP" in p
        assert "PVTSSF_lAHOAXQAu84BTrFPzhA4e9s" in p

    def test_prompt_pm_dsu_contains_ceremony_markers(self):
        p = daemon.prompt_pm([], [], [], [], mode="dsu")
        assert "YESTERDAY" in p
        assert "TODAY" in p
        assert "BLOCKERS" in p
        assert "DSU" in p
        assert "sendMessage" in p

    def test_prompt_pm_sprint_planning_contains_markers(self):
        p = daemon.prompt_pm([], [], [], [], mode="sprint_planning")
        assert "SPRINT PLANNING" in p
        assert "SPRINT CAPACITY" in p
        assert "sprint-plan.md" in p
        assert "sendMessage" in p

    def test_prompt_pm_sprint_review_contains_markers(self):
        p = daemon.prompt_pm([], [], [], [], mode="sprint_review")
        assert "SPRINT REVIEW" in p
        assert "WHAT WAS COMPLETED" in p
        assert "PLANNED vs ACTUAL" in p
        assert "sprint-plan.md" in p
        assert "sendMessage" in p

    def test_pm_mode_sprint_planning_monday_midnight(self):
        manila = timezone(timedelta(hours=8))
        monday_midnight = datetime(2026, 4, 6, 0, 5, tzinfo=manila)
        with patch("daemon.datetime") as mock:
            mock.now.return_value = monday_midnight
            mock.fromisoformat = datetime.fromisoformat
            assert daemon.pm_mode() == "sprint_planning"

    def test_pm_mode_sprint_review_sunday_evening(self):
        manila = timezone(timedelta(hours=8))
        sunday_eve = datetime(2026, 4, 12, 19, 5, tzinfo=manila)
        with patch("daemon.datetime") as mock:
            mock.now.return_value = sunday_eve
            mock.fromisoformat = datetime.fromisoformat
            assert daemon.pm_mode() == "sprint_review"

    def test_pm_mode_dsu_weekday_morning(self):
        manila = timezone(timedelta(hours=8))
        wednesday_nine = datetime(2026, 4, 8, 9, 5, tzinfo=manila)
        with patch("daemon.datetime") as mock:
            mock.now.return_value = wednesday_nine
            mock.fromisoformat = datetime.fromisoformat
            assert daemon.pm_mode() == "dsu"

    def test_pm_mode_board_sync_otherwise(self):
        manila = timezone(timedelta(hours=8))
        wednesday_afternoon = datetime(2026, 4, 8, 14, 5, tzinfo=manila)
        with patch("daemon.datetime") as mock:
            mock.now.return_value = wednesday_afternoon
            mock.fromisoformat = datetime.fromisoformat
            assert daemon.pm_mode() == "board_sync"

    def test_handle_pm_dsu_spawns_pm0(self, monkeypatch):
        monkeypatch.setattr(daemon, "fetch_work", lambda: ([], [], [], []))
        spawned = []
        monkeypatch.setattr(daemon, "spawn", lambda slot, p: spawned.append((slot, p)) or True)
        result = daemon._handle_cmd("/pm dsu")
        assert result is not None
        assert "pm-0" in result
        assert len(spawned) == 1
        assert spawned[0][0] == "pm-0"
        assert "DSU" in spawned[0][1]

    def test_handle_pm_invalid_subcommand(self):
        result = daemon._handle_cmd("/pm invalid")
        assert result is not None
        assert "Usage" in result

    def test_handle_pm_plan_uses_sprint_planning_mode(self, monkeypatch):
        monkeypatch.setattr(daemon, "fetch_work", lambda: ([], [], [], []))
        spawned = []
        monkeypatch.setattr(daemon, "spawn", lambda slot, p: spawned.append((slot, p)) or True)
        daemon._handle_cmd("/pm plan")
        assert len(spawned) == 1
        assert "SPRINT PLANNING" in spawned[0][1]

    def test_prompt_health_includes_tg_token(self):
        p = daemon.prompt_health()
        assert "sendMessage" in p
        assert "project-health.sh" in p
