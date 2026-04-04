# Agent Collaboration Protocol

This file is used to coordinate work between different AI agents working on the same repository.
Before starting any task, an agent MUST:
1. Read this file to check `## Active Work`.
2. NEVER start a ticket that is already claimed in `Active Work`.
3. Run `gh pr list --state open` and confirm no existing PR already covers the issue.
4. Claim its work by adding an entry to `## Active Work` BEFORE writing any code.
5. Update this file in the SAME commit as the work (start and finish).
6. When finished, move the entry to `## Recently Completed`.
7. SECURITY MANDATE: Detect and categorize vulnerabilities (High -> TODO, Medium/Low -> Backlog). Fix easy High ones first. Notify user if unfixable.
8. PR MERGE MANDATE: Before merging any PR, verify `mergeable_state` is clean. Rebase onto `origin/main` locally, resolve conflicts manually (never blindly `-X theirs`), verify `pnpm run typecheck` passes, then force-push and wait for CI to go green before merging.

### Ticket claim checklist (run ALL before picking a ticket)
```bash
# 1. Check active claims in this file (read above)
# 2. Check open PRs — if an issue already has a PR, skip it
export PATH="/opt/homebrew/bin:$PATH"
gh pr list --state open --json number,title,headRefName
# 3. Cross-reference with gh issue view <number> to confirm no linked PR
```
If ANY of these show the issue is taken → pick a different issue.

## Active Work
- [ ] Fix high vulnerabilities (Next.js upgrade, Fastify upgrade, tar override) | @gemini-cli | 2026-04-04
- [ ] Implement script review flow: pending_review → approve/reject/edit (issue #30, feat/issue-30-script-review-flow) | @claude-code | 2026-04-05

## Recently Completed
- [x] Add DJ link to sidebar navigation (issue #103, feat/dj-sidebar-nav) | @claude-code | 2026-04-04
- [x] DJ Personality Feature (persona_config JSONB, PersonaConfig type, prompt builder, seed, frontend form) | @claude-code | 2026-04-04
- [x] Fix @fastify/rate-limit v10→v9 for Fastify v4 compatibility (DJ + Station services) | @claude-code | 2026-04-04
- [x] Implement per-song play history timeline (feat/song-play-history) | @gemini-cli | 2026-04-04
- [x] Clone template to another station functionality (PR #107) | @gemini-cli | 2026-04-04
- [x] Create station settings service and UI (PR #96) | @previous-agent | 2026-04-04
- [x] Implement duplicate detection on song import (PR #99) | @gemini-cli | 2026-04-04
- [x] Implement self-service profile management and fix frontend Tailwind v4 build (PR #98) | @gemini-cli | 2026-04-04
- [x] Make AI DJ API keys configurable in Station Settings UI/Backend (PR #96) | @gemini-cli | 2026-04-04
- [x] Implement and verify DJ service unit tests (TTS, Worker) | @gemini-cli | 2026-04-04
- [x] Update Nginx gateway with DJ service routes | @gemini-cli | 2026-04-04
- [x] Initial DJ Service Scaffold (Implicitly completed by previous agent)
- [x] DB Migrations 016-023 (Implicitly completed by previous agent)
- [x] LLM Adapter: OpenRouter (Implicitly completed by previous agent)
- [x] Prompt Builder (Implicitly completed by previous agent)
- [x] Core Services & Routes (Implicitly completed by previous agent)
- [x] Script Generation Pipeline (BullMQ) (Implicitly completed by previous agent)
