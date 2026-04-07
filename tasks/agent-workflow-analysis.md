# Agent Workflow Analysis (#158) — 2026-04-05

Status: **Complete**. Actionable items tracked as issues. Historical document — kept for rationale behind daemon/bootstrap decisions.

## Findings & Actions

### §1 `slot_status()` reliability (`daemon.py:147–188`)
- **P0** Detect pending-input (permission prompts `"Do you want to proceed"`, `"Allow tool"`, `"(y/n)"`) → mark `needs_input`, alert via Telegram. Otherwise paused slots look `running` forever.
- **P1** Heartbeat file `/state/{slot_id}.heartbeat` (60s tick) → use mtime instead of log mtime to catch silent crashes (no log → looks running).
- **P1** Expand limit-marker detection to regex: `"limit"` + (`"reset"`|`"9am"`|`"tomorrow"`).
- **P2** Load registry once per `manage_pool()` cycle (pass as param).
- **P2** `RUNNING_IDLE_SECS=300` is too generous for fast tasks.

### §2 PM agent context (`prompt_pm()`, lines 297–352)
- **P0** Remove Telegram bot token from PM prompt body. PM writes `/state/pm-report.txt`; daemon reads and calls `tg_send()`. (Tokens currently leak to logs/CI artifacts.)
- **P1** Inject Active Work from `agent-collab.md` via `read_active_work()` so PM doesn't recommend claimed tickets.
- **P1** Replace ">24h commit" stale-claim heuristic with "branch not in open PR list".

### §3 Ticket worker handoff
- **P1** Non-overlapping issue slices by `slot_index` (mirror the `ticket-bug` pattern `[slot_index*2 : slot_index*2+2]`).
- **P1** `read_next_recommended()` helper → inject "Next Recommended Tickets" section from `agent-collab.md` into worker prompts, overriding raw issue lists when PM has written it.

### §4 Merge agent (`prompt_merge()`, lines 272–294)
- **P0** Check Migration Reservation in `agent-collab.md` before squash-merging any PR touching `shared/db/migrations/`. On duplicate migration number, close the older PR with explanation.
- **P1** Add `pnpm run typecheck` step after conflict resolution.
- **P2** Cap `max_prs_per_merge_agent=6` to prevent context exhaustion.
- **P2** Dependabot rule: auto-merge minor/patch, close on major.

### §5 Reset windows `[0,5,9,14,19]` UTC+8
- **P2** Make `reset_hours` configurable per slot type (merge: every 2h; pm: daily).
- **P2** `/reset` Telegram command → manual `manage_pool()` trigger outside schedule.

### §6 Bootstrap (`bootstrap.sh`)
- **P1** Create `tasks/TODO.md` stub (else `project-health.sh` exits 1).
- **P1** `--help-board-ids` flag → runs `gh project list` + `field-list` to guide operator through Projects V2 IDs.
- **P1** Warn explicitly if `CLAUDE_BIN` mount is missing (daemon currently fails silently to notify-only).
- **P1** Fix `sed -i` for macOS (use `sed -i ''` or Python `str.replace`).

### §7 Context window management
- **P1** Checkpoint convention: `/state/{slot_id}-checkpoint.md` after each task unit; re-spawn reads it first. _(Implemented — see CLAUDE.md.)_
- **P2** Cap issue lists in prompts to 5; rely on PM to prioritize.
- **P2** Split merge agent PR lists into batches of 4.

### §8 Daemon ↔ tg-agent integration
- **P0** (same as §2) Token out of PM prompt.
- **P1** tg-agent `/report` command reads `/state/pm-report.txt`; `/pool` shows last PM report timestamp.
- **P2** Structured event bus `/state/events.jsonl` (`{ts, agent, event_type, payload}`); tg-agent `/pool` shows last 10 events.

## Priority Matrix
| Pri | Items |
|-----|-------|
| P0 | TG token out of PM prompt · migration conflict check in merge agent · pending-input detection in `slot_status()` |
| P1 | Active Work injection · non-overlapping slices · Next Recommended injection · typecheck in merge · bootstrap TODO stub / `--help-board-ids` / macOS sed · checkpoint convention · tg-agent `/report` |
| P2 | per-slot reset windows · `/reset` command · events.jsonl · regex limit-marker · `max_prs_per_merge_agent` · registry load once · heartbeat file · 5-item prompt cap · merge PR batching |

## CLAUDE.md additions (applied)
- Agent checkpoint protocol (§8 in CLAUDE.md)
- Telegram report via file, not curl (§9)
- Migration conflict prevention (§11)
