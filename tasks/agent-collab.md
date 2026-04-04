# Agent Collaboration Notes

> **PROTOCOL**: Read this file before starting any feature or bug fix. Update it when you claim work, make progress, or finish. This prevents duplicate work across concurrent agents.

---

## How to Use

1. **Before starting**: Check `## Active Work` — if your ticket/feature is already claimed, coordinate or pick a different ticket.
2. **When claiming**: Add an entry under `## Active Work` with your branch, the ticket/issue, and a one-line description.
3. **When done**: Move the entry to `## Recently Completed` and note the PR number.
4. **When blocked**: Add a `🔴 BLOCKED` note with what you need so another agent or the user can unblock you.

Update this file as part of the same commit where you start or finish work — not separately.

---

## Active Work

| Branch | Issue / Ticket | Description | Status | Last Updated |
|--------|---------------|-------------|--------|--------------|
| `claude/clever-dijkstra` | Internal | DJ feature PoC, PR #44 (infrastructure fixes: seed, Vercel cache, tsconfig, Dependabot) | ⏳ Awaiting CI green to merge | 2026-04-04 |

---

## Recently Completed

| Branch / PR | Issue / Ticket | Description | Merged |
|-------------|---------------|-------------|--------|
| PR #35 | DJ core service | DJ service scaffold, LLM adapter, TTS adapter, profiles/scripts/segments routes, BullMQ pipeline | ✅ merged to main |
| PR #38 | DJ frontend | DJ profile page, script review UI, daypart timeline, show player context + component | ✅ merged to main |
| PR #44 | Infrastructure | Seed end_hour fix, Vercel buildCommand cache busting, tsconfig baseUrl, webpack alias, Dependabot config, dependency-review job | ⏳ pending |
| `feat/dj-auto-approve` | #33 | Add configurable script review toggle (per-station setting) — dj_auto_approve on stations table, station service, generation pipeline, and frontend toggle | ✅ ready for merge |

---

## Blocked / Needs Human Action

_Nothing blocked right now._

---

## Coordination Rules

- **One agent per ticket**: If a ticket is in `Active Work`, do not start it. Pick the next open ticket from the board.
- **Check before creating**: Before creating a new migration, check `shared/db/src/migrations/` for the highest numbered file. Claim the next number here before writing the file to avoid numbering conflicts.
- **Check before adding routes**: Before adding a new route to a service, grep for the path in that service's `routes/` directory. If it exists, the feature is already implemented.
- **Check main first**: Run `git show origin/main -- <file>` for key files before writing new code — the feature may already be merged.
- **Migration number reservation**: When planning a migration, add a row here: `| (reserved) | 023 | <description> | <branch> |` so no two agents grab the same number.

### Reserved Migration Numbers

| Migration # | Description | Branch |
|-------------|-------------|--------|
| 023 | Add persona_config JSONB to dj_profiles | (planned, not yet started) |
