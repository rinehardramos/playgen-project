# Agent Workflow Analysis & Improvement Proposals
**Date**: 2026-04-05
**Author**: @claude-code (feature-worker, issue #158)
**Status**: Complete

---

## Executive Summary

The PlayGen multi-agent system is architecturally sound but has several gaps that cause reliability issues and missed coordination opportunities. The eight areas investigated below surface **3 P0 blockers**, **5 P1 improvements**, and **4 P2 enhancements**. Proposed changes are minimal, focused, and each maps to a concrete TODO item.

---

## 1. `slot_status()` Detection — Reliability Across Edge Cases

**Current behaviour** (`tools/agent-ops/daemon/daemon.py:147–188`):

```
log idle < 5 min  → running
log idle 5–60 min → completed
log idle > 60 min → stale
log tail contains limit marker → limit_hit
no registry entry → unknown
```

**Identified gaps**

| # | Scenario | Current result | Risk |
|---|----------|---------------|------|
| A | Agent crashes silently at start; no output written | log never created → `running` (uses spawn-time fallback) → never re-spawned for 5 min | P1 — dead slot appears alive |
| B | Agent is paused waiting for human input (e.g. permission prompt) | log is being written, `idle < 5 min` → `running` | P0 — slot stuck forever |
| C | `RUNNING_IDLE_SECS = 300` is too generous for fast tasks | Slots that finish in 2 min are re-evaluated as running, delaying the next spawn by up to 3 min | P2 — pool throughput |
| D | Limit marker detection uses four hard-coded strings | Claude's phrasing changes occasionally | P1 — missed limit_hit detection |
| E | `slot_status()` re-reads the registry on every call inside `manage_pool()` | N×disk reads per cycle, where N = number of slots | P2 — performance |

**Proposals**

- **[P0-B]** Detect pending-input state by scanning the log tail for Claude's permission prompt patterns (`"Do you want to proceed"`, `"Allow tool"`, `"(y/n)"`). Mark as `needs_input` and send a Telegram alert rather than treating the slot as running.
- **[P1-A]** Add a heartbeat file approach: agent writes `echo alive` to `/state/{slot_id}.heartbeat` every 60 s. `slot_status()` checks heartbeat mtime instead of log mtime. If heartbeat is stale but log exists, treat as `completed`.
- **[P1-D]** Expand the limit marker list; alternatively match a more stable pattern: any message containing `"limit"` and (`"reset"` or `"9am"` or `"tomorrow"`) using a single regex.
- **[P2-E]** Load registry once at the top of `manage_pool()` and pass it as a parameter to `slot_status()`.

---

## 2. PM Agent — Context for Correct Prioritization

**Current behaviour** (`prompt_pm()`, daemon.py lines 297–352):

The PM prompt includes raw issue counts and instructs the agent to apply heuristics (title keywords → labels, P0/P1 labelling). However:

**Gaps**

| # | Gap | Impact |
|---|-----|--------|
| A | PM has no visibility into `agent-collab.md` Active Work at prompt-build time | May recommend tickets already claimed → wasted worker spawns |
| B | Stale-claim detection rule (">24h with no PR") has no timestamp signal in the prompt — agent must scrape GitHub commits | Fragile; often produces incorrect board moves |
| C | PM prompt sends a Telegram report using a `curl` with the bot token embedded in the prompt body | Security risk — token in logs |

**Proposals**

- **[P1-A]** Inject current Active Work section content into the PM prompt. The daemon already reads `agent-collab.md` (it's in `COLLAB_FILE`). Add a `read_active_work()` helper that returns the Active Work lines, include in `prompt_pm()`.
- **[P1-B]** Replace the ">24h commit" heuristic with: a claim is stale if its branch name does not appear in the list of open PR branches. The daemon already fetches all open PRs.
- **[P0-C]** Remove the `curl` + token from the PM prompt body. Instead, have the PM write a plain text file `/state/pm-report.txt`; the daemon reads it post-execution and calls `tg_send()`. This keeps the token server-side only.

---

## 3. Ticket Worker Handoff — Cross-Worker Awareness

**Current behaviour**: Each ticket worker reads `agent-collab.md` to avoid claiming active tickets. The daemon builds independent prompts per slot from the same snapshot of GitHub issues.

**Gaps**

| # | Gap | Impact |
|---|-----|--------|
| A | All ticket workers receive overlapping issue lists (feat-0 gets issues 1–3, bug-0 also gets features as fallback) | Duplicate claims possible in the same cycle |
| B | `prompt_ticket_feat()` slices `feat_issues[:3]`; if two feature workers are spawned, both may see the same issue | Race condition |
| C | `agent-collab.md` has no "Next Recommended Tickets" section in the live file (only in the template) | Workers ignore PM recommendations; each picks independently |

**Proposals**

- **[P1-A/B]** Assign non-overlapping slices: `ticket-feat-0` gets `feat_issues[0:2]`, `ticket-feat-1` gets `feat_issues[2:4]`. Apply the same slice logic already used for `ticket-bug` workers (`slot_index * 2`).
- **[P1-C]** Add a daemon helper `read_next_recommended()` that reads the "Next Recommended Tickets" section from `agent-collab.md` and injects it into ticket-worker prompts, overriding the raw issue list when available. This creates a clean PM → worker handoff channel.

---

## 4. Merge Agent — Conflict Handling Completeness

**Current behaviour** (`prompt_merge()`, daemon.py lines 272–294):

```
gh pr checks → wait if pending → resolve conflicts
(keep main for CHANGELOG/agent-collab.md, pnpm install for lockfile)
→ gh pr merge --squash --delete-branch
```

**Gaps**

| # | Gap | Impact |
|---|-----|--------|
| A | Conflict resolution instruction says "keep main for CHANGELOG" but doesn't address migration file conflicts | Migrations could be merged incorrectly → broken DB schema |
| B | No instruction to run `pnpm run typecheck` before merge | Type errors slip through if CI has not run yet |
| C | Dep PRs (dependabot) — "close if major breaking change" rule has no mechanism; agent must judge manually | Inconsistent handling |
| D | No upper bound on concurrent merge attempts; if 12 feature PRs are open, one agent tries all sequentially | Context-window exhaustion |

**Proposals**

- **[P0-A]** Add to merge prompt: "For migration files (`shared/db/migrations/*.sql`), check the Migration Reservation section in `agent-collab.md` before merging. If two PRs modify the same migration number, close the older one and comment with the conflict."
- **[P1-B]** Add `pnpm run typecheck` step after conflict resolution in the merge prompt.
- **[P2-C]** Add a `max_prs_per_merge_agent: 6` config option; slice `feature_prs` accordingly when building the prompt.
- **[P2-D]** For dep PRs, inject a simple rule: "Only merge if the version bump is minor or patch. Close if major."

---

## 5. Reset Window Timing — Are 5 Windows/Day Optimal?

**Current behaviour**: Resets at `[0, 5, 9, 14, 19]` UTC+8 = 5 windows/day, ~4–5 hour gaps.

**Analysis**

A ticket-worker session for a medium feature takes ~60–90 min. With 5-hour gaps, there's a 3–4 hour idle period between batches. A merge-agent run over 8+ PRs may hit context limits before finishing, then stalls until the next reset.

The `last_hour` dedup guard (`time.sleep(90); continue`) ensures double-fires don't happen, but the 90s grace is arbitrary.

**Proposals**

- **[P2-A]** Make `reset_hours` configurable per slot type in the config schema. A `merge` slot could reset every 2 hours; a `pm` slot once per day is sufficient.
- **[P2-B]** Add a `/reset` Telegram command to the tg-agent bot that manually triggers `manage_pool()` outside the scheduled windows. This handles the "merge agent stalled mid-cycle" case without waiting hours.

---

## 6. Agent-Ops Bootstrap — Completeness for Greenfield Projects

**Current behaviour** (`bootstrap.sh`, 417 lines, 8 steps):

Steps: copy CI/CD workflows → install CLAUDE.md → install templates → copy scripts → generate config → create .env → update .gitignore → build+start Docker.

**Gaps**

| # | Gap | Impact |
|---|-----|--------|
| A | Bootstrap does not create a `tasks/TODO.md` file — `project-health.sh` reads it and exits 1 if missing | Health checks fail on fresh projects |
| B | `project.config.json` generation requires `board_id` and `status_field_id` from GitHub Projects v2; the script provides no guidance on retrieving them | Operators get stuck on initial setup |
| C | Bootstrap starts Docker but does not verify Claude CLI is present or mounted | Daemon starts in notify-only mode silently |
| D | Template `CLAUDE.md` uses `{{PROJECT_NAME}}` placeholder; bootstrap uses `sed -i` — on macOS, `sed -i ''` syntax differs | Bootstrap fails on macOS without the empty string arg |

**Proposals**

- **[P1-A]** Add step 9: create `tasks/TODO.md` with a minimal phase structure matching what `project-health.sh` expects.
- **[P1-B]** Add `--help-board-ids` flag that runs `gh project list` and `gh project field-list` and prints the relevant IDs, making it a guided setup.
- **[P1-C]** After Docker start, check `CLAUDE_BIN` mountpoint and warn explicitly if not present.
- **[P1-D]** Replace `sed -i` with `sed -i ''` on macOS or use Python `str.replace()` to avoid cross-platform issues.

---

## 7. Context Window Management — How Agents Avoid Hitting Limits

**Current approach**: Agents hit context limits naturally; the daemon detects `limit_hit` via log tail and re-spawns at the next window.

**Gaps**

| # | Gap | Impact |
|---|-----|--------|
| A | No proactive context-saving behavior — when an agent is near the limit, no partial state is preserved | Work-in-progress lost if limit hit mid-task |
| B | Ticket prompts include raw issue lists that grow with open issues — a 50-issue backlog inflates every prompt | Context consumed unnecessarily |
| C | Merge agent receives all PRs in one prompt; each PR's review may consume 2–5K tokens of context | Context exhaustion on large PR queues |

**Proposals**

- **[P1-A]** Add a checkpoint convention: each agent writes `/state/{slot_id}-checkpoint.md` after each completed task unit. On re-spawn after `limit_hit`, the prompt instructs the agent to read the checkpoint and continue from where it left off.
- **[P2-B]** Cap issue lists in prompts to 5 items maximum (already done for bugs: `bug_issues[slot_index * 2: slot_index * 2 + 2]`). Apply universally and have the PM write prioritized lists to `agent-collab.md`.
- **[P2-C]** Split the merge agent's PR list into batches of 4. If `len(feature_prs) > 4`, spawn multiple merge slots.

---

## 8. Daemon → tg-agent Integration — PM Reports Through tg-agent

**Current behaviour**: The PM agent sends Telegram messages directly via `curl` inside the prompt. The tg-agent bot and daemon send independently. State sharing is via `/state` volume.

**Gaps**

| # | Gap | Impact |
|---|-----|--------|
| A | PM sends its own Telegram message with the bot token embedded in a shell command in the prompt text | Token leaks into logs, CI artifacts |
| B | `/pool` command in tg-agent reads state files but cannot show PM's latest report | Incomplete status picture |
| C | No structured event bus — daemon, PM, tg-agent communicate only via flat files and Telegram | Hard to extend with new agent types |

**Proposals**

- **[P0-A]** (cross-reference §2-C) Remove token from PM prompt. PM writes `/state/pm-report.txt`; daemon reads after PM completes and calls `tg_send()`.
- **[P1-B]** Add `/report` command to tg-agent that reads `/state/pm-report.txt` and displays it. Update `/pool` to include the last PM report timestamp.
- **[P2-C]** Define a structured event format in `/state/events.jsonl` (one JSON line per event: `{ts, agent, event_type, payload}`). All agents append to this file. tg-agent's `/pool` command shows the last 10 events as a lightweight audit trail.

---

## Priority Summary

### P0 Blockers (implement immediately)

| ID | Item | File to change |
|----|------|----------------|
| P0-1 | Remove Telegram bot token from PM agent prompt body | `tools/agent-ops/daemon/daemon.py` → `prompt_pm()` |
| P0-2 | Merge agent: detect migration conflicts before squash merge | `tools/agent-ops/daemon/daemon.py` → `prompt_merge()` |
| P0-3 | `slot_status()`: detect pending-input state (permission prompt) | `tools/agent-ops/daemon/daemon.py` → `slot_status()` |

### P1 Improvements (next sprint)

| ID | Item | File to change |
|----|------|----------------|
| P1-1 | Inject Active Work section into PM prompt | `daemon.py` → `prompt_pm()` + new `read_active_work()` |
| P1-2 | Non-overlapping issue slices for ticket-feat workers | `daemon.py` → `prompt_ticket_feat()` |
| P1-3 | `read_next_recommended()` → inject into ticket-worker prompts | `daemon.py` + `agent-collab.md` template |
| P1-4 | Add `pnpm run typecheck` to merge prompt | `daemon.py` → `prompt_merge()` |
| P1-5 | Bootstrap: create `tasks/TODO.md` stub | `tools/agent-ops/bootstrap.sh` |
| P1-6 | Bootstrap: `--help-board-ids` flag | `tools/agent-ops/bootstrap.sh` |
| P1-7 | Bootstrap: fix `sed -i` macOS compatibility | `tools/agent-ops/bootstrap.sh` |
| P1-8 | Agent checkpoint convention for limit_hit recovery | `daemon.py` + CLAUDE.md |
| P1-9 | tg-agent: `/report` command for PM reports | `tools/agent-ops/tg-agent/bot.py` |

### P2 Enhancements (backlog)

| ID | Item | File to change |
|----|------|----------------|
| P2-1 | Per-slot-type reset windows in config | `project.config.json` schema + `daemon.py` |
| P2-2 | tg-agent: `/reset` command to manually trigger `manage_pool()` | `tools/agent-ops/tg-agent/bot.py` |
| P2-3 | `/state/events.jsonl` structured audit log | `daemon.py` + `tg-agent/bot.py` |
| P2-4 | Expand limit marker detection to regex | `daemon.py` → `slot_status()` |
| P2-5 | `max_prs_per_merge_agent` config option | `project.config.json` + `daemon.py` |
| P2-6 | Load registry once per `manage_pool()` cycle | `daemon.py` → `manage_pool()` |

---

## New GitHub Issues to Create

```
[P0] Security: remove Telegram bot token from PM agent prompt — write /state/pm-report.txt instead
[P0] slot_status(): detect pending-input (permission prompt) as blocked state, alert via Telegram
[P0] Merge agent: check Migration Reservation in agent-collab.md before squash merge
[P1] PM prompt: inject current Active Work section from agent-collab.md
[P1] Ticket worker prompts: non-overlapping issue slices by slot_index
[P1] Ticket worker prompts: read Next Recommended from agent-collab.md when PM has written it
[P1] Merge agent prompt: add pnpm typecheck step before gh pr merge
[P1] bootstrap.sh: create tasks/TODO.md stub in step 9
[P1] bootstrap.sh: --help-board-ids flag for guided GitHub Projects v2 setup
[P1] bootstrap.sh: fix sed -i macOS compatibility (use sed -i '')
[P1] Agent checkpoint convention: /state/{slot_id}-checkpoint.md on limit_hit re-spawn
[P1] tg-agent: add /report command to display latest PM report
[P2] Per-slot-type reset windows in project.config.json
[P2] tg-agent: /reset command to manually trigger manage_pool() outside schedule
[P2] /state/events.jsonl: structured audit log for all agent events
```

---

## Proposed CLAUDE.md Additions

Add under **Agent Intelligence & Workflow Orchestration**:

```markdown
### 8. Agent Checkpoint Protocol
- After completing each task unit (merged PR, resolved issue, completed sub-task), write a checkpoint to `/state/{slot_id}-checkpoint.md`
- Checkpoint format: `## Checkpoint\nCompleted: [list]\nNext: [next task]\nState: [any relevant context]`
- On re-spawn after limit_hit, read your checkpoint file first and resume from where you left off

### 9. Telegram Report via File (not curl)
- NEVER embed the Telegram bot token in a shell command within your prompt output
- To send a Telegram message from an agent, write the message to `/state/{slot_id}-report.txt`
- The daemon will read this file and send the message via tg_send()

### 10. Migration Conflict Prevention
- Before merging any PR that touches `shared/db/migrations/`, check the Migration Reservation section in tasks/agent-collab.md
- If two open PRs claim the same migration number, close the older one with a comment explaining the conflict
```
