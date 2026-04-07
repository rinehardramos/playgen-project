---
name: agent-ops
description: Protocols for PlayGen agents spawned by the daemon pool. Use when operating as a daemon-spawned agent (ticket-worker, merge-agent, PM), hitting a Claude Code rate limit mid-session, resolving a complex bug worth persisting to L2 memory, or sending a Telegram report. Covers checkpoints, rate-limit graceful degradation, L2 Qdrant memory, and Telegram-via-file.
allowed-tools: Bash Read Write Edit
---

# Agent Operations Protocols

Only relevant when running as a daemon-spawned agent or when a rate limit forces a hand-off.

## Checkpoint Protocol
After each completed task unit (merged PR, resolved issue, completed sub-task), write:
```
/state/{slot_id}-checkpoint.md

## Checkpoint
Completed: [list]
Next: [next task]
State: [relevant context]
```
On re-spawn after `limit_hit`, read your checkpoint file first and resume from there.

## Rate Limit Graceful Degradation
If a Claude Code rate limit is reached mid-session, DO NOT stop or block:
1. For each unstarted task, create a GitHub issue:
   ```bash
   gh issue create --title "..." --body "..." --label "P1"
   ```
2. Include full pickup context in the body: background, acceptance criteria, files to touch, dependencies. The next agent must be able to start cold.
3. Update `tasks/agent-collab.md` to reflect the hand-off.

The user should never have to manually transcribe your mental state into tickets.

## Telegram Report via File (NEVER curl)
NEVER embed the Telegram bot token in a shell command within prompt output — it leaks to logs and CI artifacts.

To send a Telegram message:
```bash
Write /state/{slot_id}-report.txt
```
The daemon reads this file at the next reset window and calls `tg_send()`.

## L2 Memory (Qdrant)
For every complex issue, architectural roadblock, or bug successfully resolved, embed the context + symptoms + applied fix into the L2 Vector DB:
- Use `KnowledgeBaseClient` to push a synthesized `MemoryEntry` into the `agent_insights` collection.
- Creates a permanent semantic immune system — future agents naturally retrieve the exact fix when identical tracebacks surface.
