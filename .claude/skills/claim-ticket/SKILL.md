---
name: claim-ticket
description: Coordinate work between agents on the shared PlayGen repo. Use BEFORE starting any GitHub issue/ticket, claiming work, or opening a branch; also before merging a PR that touches shared/db/migrations/. Reads tasks/agent-collab.md for Active Work, Migration Reservation, and mandates.
allowed-tools: Read Edit Bash
---

# Agent Collaboration Gate

Before starting, claiming, or merging work in a shared-agent context, follow this protocol.

## 1. Read current state
```
Read tasks/agent-collab.md
```
Inspect:
- **`## Active Work`** — NEVER start a ticket already claimed here.
- **`## Migration Reservation`** — if your work touches `shared/db/migrations/`, claim your migration number here first. If two open PRs claim the same number, close the older one with an explanatory comment.

## 2. Claim
Add a line to `## Active Work` in the same commit that starts the work:
```
- [ ] <type>(<scope>): <summary> (#<issue>, <branch>) | @<agent> | <YYYY-MM-DD> | Migration: <n>
```

## 3. Gates before finishing

**Pre-PR (NON-NEGOTIABLE)** — invoke `/pre-pr-gate` or run:
```bash
pnpm run typecheck && pnpm run lint && pnpm run test:unit
```
Must be 1:1 with GitHub Actions. If a Dockerfile or workspace dep changed, also `docker build -f services/<svc>/Dockerfile .`.

**Merge gate** — `mergeable_state` clean. Rebase onto `origin/main` locally, resolve conflicts manually (NEVER `-X theirs`), typecheck, push, wait for CI green, then merge.

**Acceptance criteria** — NEVER move a ticket to Done unless all `- [ ]` items in the linked issue are `- [x]`. Verify with `gh issue view <N>` before `gh project item-edit ... Done`.

**Security** — categorize vulns (High → TODO, Medium/Low → Backlog). Fix easy Highs first. Notify user if unfixable.

## 4. Finish
Move the entry from `## Active Work` to `## Recently Completed` with PR number.
