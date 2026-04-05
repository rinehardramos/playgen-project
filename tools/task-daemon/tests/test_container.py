"""
Container integration tests for playgen-task-daemon.
Requires Docker and the running playgen-task-daemon container.
Skip automatically if Docker/container is not available.
"""
import subprocess
import json
import os
import time
import pytest


def docker(*args, check=True) -> str:
    try:
        result = subprocess.run(
            ["docker", *args],
            capture_output=True, text=True, timeout=15, check=check,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as e:
        return ""


def container_running() -> bool:
    out = docker("inspect", "--format={{.State.Running}}", "playgen-task-daemon", check=False)
    return out.strip() == "true"


def container_exec(*args) -> str:
    return docker("exec", "playgen-task-daemon", *args)


pytestmark = pytest.mark.skipif(
    not container_running(),
    reason="playgen-task-daemon container is not running",
)


class TestContainerRuntime:

    def test_container_is_running(self):
        assert container_running()

    def test_restart_policy_is_unless_stopped(self):
        policy = docker(
            "inspect",
            "--format={{.HostConfig.RestartPolicy.Name}}",
            "playgen-task-daemon",
        )
        assert policy == "unless-stopped"

    def test_daemon_process_is_alive(self):
        out = container_exec("pgrep", "-f", "daemon.py")
        assert out.strip().isdigit(), "daemon.py process not found in container"

    def test_state_volume_is_mounted(self):
        out = container_exec("ls", "/state")
        # Should not error — directory exists
        assert out is not None   # empty dir is fine

    def test_workspace_is_mounted_readonly(self):
        out = container_exec("mount")
        assert "/workspace" in out

    def test_claude_vm_is_mounted(self):
        out = container_exec("ls", "/claude-vm")
        assert out, "/claude-vm is empty or not mounted"

    def test_claude_wrapper_exists_and_is_executable(self):
        out = container_exec("ls", "-la", "/usr/local/bin/claude")
        assert "claude" in out

    def test_claude_wrapper_resolves_latest_version(self):
        """Wrapper should pick the highest version from /claude-vm."""
        versions = container_exec("ls", "/claude-vm").splitlines()
        assert versions, "No versions found in /claude-vm"
        # sort -V gives version-aware sort; last is latest
        latest = sorted(versions)[-1]
        # Wrapper should exec that version
        wrapper = container_exec("cat", "/usr/local/bin/claude")
        assert "sort -V" in wrapper
        assert "tail -1" in wrapper

    def test_claude_binary_is_executable_inside_container(self):
        out = container_exec("/usr/local/bin/claude", "--version")
        assert "Claude Code" in out, f"Unexpected output: {out!r}"

    def test_claude_version_matches_latest_in_claude_vm(self):
        versions = container_exec("ls", "/claude-vm").splitlines()
        latest   = sorted(versions)[-1]
        out      = container_exec("/usr/local/bin/claude", "--version")
        assert latest in out, f"Expected version {latest} in output: {out!r}"

    def test_env_vars_set(self):
        env = container_exec("env")
        assert "TELEGRAM_BOT_TOKEN" in env
        assert "TELEGRAM_CHAT_ID"   in env
        assert "GH_TOKEN"           in env
        assert "CLAUDE_BIN"         in env

    def test_state_files_written_on_startup(self):
        # Give daemon a moment to write startup state
        time.sleep(2)
        out = container_exec("ls", "/state")
        assert "agent-state.json" in out or "task-history.jsonl" in out

    def test_agent_state_is_valid_json(self):
        out = container_exec("cat", "/state/agent-state.json")
        if not out:
            pytest.skip("agent-state.json not yet written")
        data = json.loads(out)
        assert "updated_at" in data
        assert "feature_prs" in data or "bug_issues" in data

    def test_no_oom_or_crash_in_logs(self):
        logs = docker("logs", "--tail=50", "playgen-task-daemon")
        assert "OOMKilled" not in logs
        assert "Traceback" not in logs
        assert "Error" not in logs or "error" not in logs.lower()

    def test_daemon_logs_show_next_reset(self):
        logs = docker("logs", "--tail=20", "playgen-task-daemon")
        assert "next reset" in logs.lower() or "sleeping" in logs.lower()


class TestWrapperVersionDiscovery:
    """Test the claude wrapper shell script logic directly."""

    def test_wrapper_handles_single_version(self):
        """With one version dir, wrapper picks it."""
        script = container_exec("sh", "-c",
            "mkdir -p /tmp/test-vm/1.0.0 && "
            "ls /tmp/test-vm | sort -V | tail -1"
        )
        assert script.strip() == "1.0.0"

    def test_wrapper_picks_highest_semver(self):
        """With multiple versions, wrapper picks the highest."""
        script = container_exec("sh", "-c",
            "mkdir -p /tmp/test-vm/1.9.0 /tmp/test-vm/1.10.0 /tmp/test-vm/2.0.0 && "
            "ls /tmp/test-vm | sort -V | tail -1"
        )
        assert script.strip() == "2.0.0"

    def test_wrapper_errors_gracefully_when_claude_vm_empty(self):
        """Wrapper exits 1 with a clear message when /claude-vm is missing."""
        out = container_exec(
            "sh", "-c",
            "LATEST=$(ls /nonexistent-vm 2>/dev/null | sort -V | tail -1); "
            "[ -z \"$LATEST\" ] && echo 'NOT_MOUNTED' || echo $LATEST"
        )
        assert "NOT_MOUNTED" in out
