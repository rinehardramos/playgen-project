# Agent Collaboration Protocol

This file is used to coordinate work between different AI agents working on the same repository.
Before starting any task, an agent MUST:
1. Read this file to check `## Active Work`.
2. NEVER start a ticket that is already claimed in `Active Work`.
3. Claim its work by adding an entry to `## Active Work`.
4. Update this file in the SAME commit as the work (start and finish).
5. When finished, move the entry to `## Recently Completed`.
6. SECURITY MANDATE: Detect and categorize vulnerabilities (High -> TODO, Medium/Low -> Backlog). Fix easy High ones first. Notify user if unfixable.
7. PR MERGE MANDATE: Before merging any PR, verify `mergeable_state` is clean. Rebase onto `origin/main` locally, resolve conflicts manually (never blindly `-X theirs`), verify `pnpm run typecheck` passes, then force-push and wait for CI to go green before merging.
8. **PRE-PR TESTING MANDATE (NON-NEGOTIABLE)**: Before ANY `git push`, run locally: `pnpm run typecheck && pnpm run lint && pnpm run test:unit`. ALL must pass. Local results must be 1:1 with GitHub Actions CI. If a Dockerfile changed or new workspace dep added, also run `docker build -f services/<svc>/Dockerfile .` to verify. NO exceptions — type errors, lint failures, and integration issues must NEVER reach the pipeline.
9. **ACCEPTANCE CRITERIA MANDATE**: NEVER move a ticket to Done unless ALL `- [ ]` acceptance criteria in the GitHub issue are checked off (`- [x]`). Verify with `gh issue view <N>` before calling `gh project item-edit` to set status Done. Check off each criterion as it is implemented in the merged PR.

## Next Recommended Tickets

### For ticket-bug workers (P0 first)
1. **#247** — P0: Frontend /programs page calls /api/v1/stations (404) + /programs/new uses different endpoint
2. **#246** — P0: Frontend Docker image can't find server.js (Next standalone monorepo layout)

### For ticket-feat worker
_(no open recommended tickets — check GitHub Issues for new work)_

---

## Active Work
_(cleared 2026-04-09 — all info-broker issues #319-#325 merged)_

## Recently Completed
- [x] feat(shared): @playgen/info-broker-client workspace package (#319, PR #334) | @claude-code | 2026-04-09
- [x] feat(dj): info-broker integration chain — weather+news+songs+jokes+socials+segment API+drop api keys (#320-#325, PR #336) | @claude-code | 2026-04-09 | Migrations: 053, 054, 055
- [x] feat(dj): Streaming output adapter interface — IcecastAdapter stub + unit tests (issue #27, feat/issue-27-streaming-adapter) | @claude-code | 2026-04-06
- [x] feat(station): System Logs page — audit trail (issue #197, PR #236) | @claude-code | 2026-04-06 | Migration: 050
- [x] feat(dj): Adlib segments — pre-recorded clip library + AI-generated + configurable interval (issue #206, PR #232) | @claude-code | 2026-04-06 | Migration: 049
- [x] docs(infra): Infrastructure Settings Registry (issue #230, PR #231) | @claude-code | 2026-04-06
- [x] feat(dj): Facebook + Twitter/X social adapters for listener shoutouts (issues #211, #212, PR #225) | @claude-code | 2026-04-06 | Migrations: 040, 041
- [x] feat(dj): Weather segment — IDataProvider types, MockWeatherAdapter, weather_tease seed (issue #207, PR #229) | @claude-code | 2026-04-06
- [x] feat(dj): Time Check segment — localized time_check injection (issue #203, feat/issue-203-204-dj-segments) | @claude-code | 2026-04-06
- [x] feat(dj): Station ID segment — callsign/tagline/frequency injection (issue #204, feat/issue-203-204-dj-segments) | @claude-code | 2026-04-06
- [x] Google OAuth login (issue #200, feat/issue-200-google-oauth) | @claude-code | 2026-04-05
- [x] Fix DJ INTERNAL_ERROR: reject handler 422/503 error codes (issue #183, fix/issue-183-dj-error) | @claude-code | 2026-04-05
- [x] Agent workflow improvements — P0 daemon fixes + CLAUDE.md rules (issue #158, feat/issue-158-workflow-improvements) | @claude-code | 2026-04-05
- [x] Chatbox for directed script rewrite instructions (issue #32, PR #180) | @claude-code | 2026-04-05
- [x] Deployment monitoring agent — Vercel + Railway (issue #166, PR #169) | @claude-code | 2026-04-05
- [x] Script review UI (issue #31, PR #173) | @claude-code | 2026-04-05
- [x] Re-generate single slot (issue #132, PR #140) | @claude-code | 2026-04-04
- [x] Generation failure alerting — endpoint + UI red badge (issue #133, PRs #163/#167) | @claude-code | 2026-04-05
- [x] Category distribution report by date + chart (issue #134, PR #172) | @claude-code | 2026-04-05
- [x] Fix high vulnerabilities (Next.js 15 / Fastify 5 / tar override, PR #110) | @gemini-cli | 2026-04-04
- [x] S3 storage adapter + audio cleanup job (issue #24, PR #176) | @claude-code | 2026-04-05
- [x] Script template management UI (issue #20, PR #150) | @claude-code | 2026-04-05
- [x] DJ Show Player with volume control (issue #21, PR #151) | @claude-code | 2026-04-05
- [x] Spotify/Apple Music embed widgets (issue #22, PR #155) | @claude-code | 2026-04-05
- [x] Visual show timeline + audio export CSV (issue #23, PR #156) | @claude-code | 2026-04-05
- [x] Implement GET /api/v1/dashboard/stats endpoint (issue #101, feat/dashboard-stats) | @claude-code | 2026-04-05
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
