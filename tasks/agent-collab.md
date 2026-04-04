# Agent Collaboration Protocol

This file is used to coordinate work between different AI agents working on the same repository.
Before starting any task, an agent MUST:
1. Read this file to check `## Active Work`.
2. NEVER start a ticket that is already claimed in `Active Work`.
3. Claim its work by adding an entry to `## Active Work`.
4. Update this file in the SAME commit as the work (start and finish).
5. When finished, move the entry to `## Recently Completed`.

## Rules

- **Create a ticket first**: If user requests a feature or reports a bug, create a GitHub issue BEFORE implementing.
- **No direct Railway deploys**: Push to main and let CI/CD pipeline deploy. Never use `railway up` directly.
- **Fix root causes**: No workarounds. Diagnose and fix the real issue.
- **No untracked work**: Every feature/bug/task must have a GitHub issue.

## Active Work
- [ ] Build Daypart Assignment UI (issue #18) | @claude-sonnet | 2026-04-04 | feat/dj-daypart-ui

## Recently Completed
- [x] Add DJ link to sidebar navigation (issue #103, feat/dj-sidebar-nav) | @claude-code | 2026-04-04
- [x] DJ Personality Feature (persona_config JSONB, PersonaConfig type, prompt builder, seed, frontend form) | @claude-code | 2026-04-04
- [x] Fix @fastify/rate-limit v10→v9 for Fastify v4 compatibility (DJ + Station services) | @claude-code | 2026-04-04
- [x] Make AI DJ API keys configurable in Station Settings UI/Backend | @gemini-cli | 2026-04-04
- [x] Implement and verify DJ service unit tests (TTS, Worker) | @gemini-cli | 2026-04-04
- [x] Update Nginx gateway with DJ service routes | @gemini-cli | 2026-04-04
- [x] Initial DJ Service Scaffold (Implicitly completed by previous agent)
- [x] DB Migrations 016-023 (Implicitly completed by previous agent)
- [x] LLM Adapter: OpenRouter (Implicitly completed by previous agent)
- [x] Prompt Builder (Implicitly completed by previous agent)
- [x] Core Services & Routes (Implicitly completed by previous agent)
- [x] Script Generation Pipeline (BullMQ) (Implicitly completed by previous agent)
