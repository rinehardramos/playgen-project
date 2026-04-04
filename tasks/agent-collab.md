# Agent Collaboration Protocol

This file is used to coordinate work between different AI agents working on the same repository.
Before starting any task, an agent MUST:
1. Read this file to check `## Active Work`.
2. NEVER start a ticket that is already claimed in `Active Work`.
3. Claim its work by adding an entry to `## Active Work`.
4. Update this file in the SAME commit as the work (start and finish).
5. When finished, move the entry to `## Recently Completed`.

## Active Work
- [ ] Build script review UI (#31) | @gemini-cli | 2026-04-04

## Recently Completed
- [x] DJ Personality Feature (persona_config JSONB, PersonaConfig type, prompt builder, seed, frontend form) | @claude-code | 2026-04-04
- [x] Fix @fastify/rate-limit v10→v9 for Fastify v4 compatibility (DJ + Station services) | @claude-code | 2026-04-04
- [x] Clone template to another station functionality (feat/clone-template) | @gemini-cli | 2026-04-04
- [x] Create station settings service and UI (PR #96) | @previous-agent | 2026-04-04
- [x] Implement duplicate detection on song import (feat/duplicate-detection-import) | @gemini-cli | 2026-04-04
- [x] Implement self-service profile management and fix frontend Tailwind v4 build (PR #98) | @gemini-cli | 2026-04-04
- [x] Make AI DJ API keys configurable in Station Settings UI/Backend | @gemini-cli | 2026-04-04
- [x] Implement and verify DJ service unit tests (TTS, Worker) | @gemini-cli | 2026-04-04
- [x] Update Nginx gateway with DJ service routes | @gemini-cli | 2026-04-04
- [x] Initial DJ Service Scaffold (Implicitly completed by previous agent)
- [x] DB Migrations 016-023 (Implicitly completed by previous agent)
- [x] LLM Adapter: OpenRouter (Implicitly completed by previous agent)
- [x] Prompt Builder (Implicitly completed by previous agent)
- [x] Core Services & Routes (Implicitly completed by previous agent)
- [x] Script Generation Pipeline (BullMQ) (Implicitly completed by previous agent)
