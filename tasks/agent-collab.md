# Agent Collaboration Protocol

Coordination between AI agents on the same repo. Before starting any task:

1. Read `## Active Work`. NEVER start a ticket already claimed.
2. Claim by adding an entry (in the same commit as work start).
3. On finish, move the entry to `## Recently Completed`.
4. **Pre-PR gate (NON-NEGOTIABLE)**: `pnpm run typecheck && pnpm run lint && pnpm run test:unit` must pass locally — 1:1 with GitHub Actions. If a Dockerfile/workspace dep changed, also `docker build -f services/<svc>/Dockerfile .`.
5. **Merge gate**: `mergeable_state` must be clean. Rebase onto `origin/main` locally, resolve conflicts manually (NEVER `-X theirs`), typecheck, push, wait for CI green, then merge.
6. **Acceptance criteria**: NEVER move a ticket to Done unless all `- [ ]` items in the issue are `- [x]`. Verify via `gh issue view <N>` before `gh project item-edit ... Done`.
7. **Security**: categorize vulns (High → TODO, Medium/Low → Backlog). Fix easy Highs first. Notify user if unfixable.
8. **Migrations**: check the Migration Reservation section below before touching `shared/db/migrations/`.

## Active Work
- [ ] fix(playlist): ?date=YYYY-MM-DD filter on GET /stations/:sid/playlists (#292, fix/issue-292-playlist-date-filter) | @claude-code | 2026-04-08
_(cleared 2026-04-08 by PM agent — all prior claims verified CLOSED with no open PR)_

## Migration Reservation
Claim sequential migration numbers here before writing files. Close older PR on conflict.

## Recently Completed (last 14 days)
- [x] fix(db): migration 026 idempotent DO block + 044 ON CONFLICT→WHERE NOT EXISTS (#254/#255, fix/issue-254-255-migration-bugs) | 2026-04-06
- [x] feat(dj): Streaming output adapter interface — IcecastAdapter stub + unit tests (#27, feat/issue-27-streaming-adapter) | 2026-04-06
- [x] feat(station): System Logs page — audit trail (#197, PR #236) | 2026-04-06 | Migration: 050
- [x] feat(dj): Adlib segments — pre-recorded clip library + AI-generated + configurable interval (#206, PR #232) | 2026-04-06 | Migration: 049
- [x] docs(infra): Infrastructure Settings Registry (#230, PR #231) | 2026-04-06
- [x] feat(dj): FB + X social adapters (#211/#212, PR #225) | 2026-04-06 | Migrations 040, 041
- [x] feat(dj): Weather segment — IDataProvider, MockWeatherAdapter, weather_tease seed (#207, PR #229) | 2026-04-06
- [x] feat(dj): Time Check + Station ID segments (#203/#204, feat/issue-203-204-dj-segments) | 2026-04-06
- [x] feat(auth): Google OAuth login (#200, feat/issue-200-google-oauth) | 2026-04-05
- [x] fix(dj): reject handler 422/503 codes (#183, fix/issue-183-dj-error) | 2026-04-05
- [x] feat(agent-ops): P0 daemon fixes + CLAUDE.md rules (#158) | 2026-04-05
- [x] feat(dj): chatbox for directed rewrites (#32, PR #180) | 2026-04-05
- [x] feat(ops): Vercel + Railway deployment monitor (#166, PR #169) | 2026-04-05
- [x] feat(dj): Script review UI (#31, PR #173) | 2026-04-05
- [x] feat(scheduler): re-generate single slot (#132, PR #140) | 2026-04-04
- [x] feat(alerts): generation failure endpoint + red badge (#133, PRs #163/#167) | 2026-04-05
- [x] feat(analytics): category distribution by date + chart (#134, PR #172) | 2026-04-05
- [x] chore(deps): Next 15 / Fastify 5 / tar high-vuln override (PR #110) | @gemini-cli | 2026-04-04
- [x] feat(dj): S3 storage adapter + audio cleanup (#24, PR #176) | 2026-04-05
- [x] feat(dj): script template management UI (#20, PR #150) | 2026-04-05
- [x] feat(dj): show player with volume control (#21, PR #151) | 2026-04-05
- [x] feat(dj): Spotify/Apple embed widgets (#22, PR #155) | 2026-04-05
- [x] feat(dj): visual timeline + audio CSV export (#23, PR #156) | 2026-04-05
- [x] feat(dashboard): GET /api/v1/dashboard/stats (#101) | 2026-04-05
- [x] feat(dj): persona_config JSONB + prompt builder + seed + UI | 2026-04-04
- [x] fix(deps): @fastify/rate-limit v10→v9 (DJ + Station) | 2026-04-04
