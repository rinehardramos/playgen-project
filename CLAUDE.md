# PlayGen — CLAUDE.md

## Core Principles
- **Simplicity & minimal impact**: touch only what's necessary; no speculative abstractions.
- **Root cause only**: no bandaids, hardcoded values, or temporary fixes. If you can't state the root cause in one sentence, keep investigating.
- **Verify before done**: prove it works (tests, logs, diffs). Would a staff engineer approve?

## Workflow
- **Plan mode** for any non-trivial task (3+ steps or architectural). If things go sideways, STOP and re-plan.
- **Subagents** for research, exploration, parallel analysis — keep main context clean.
- **Autonomous bug fixing**: given a bug, just fix it. No hand-holding.
- **Elegance check** on non-trivial changes: "is there a more elegant way?" Skip for obvious fixes.

## Skills (invoke by trigger)
- **`/pre-pr-gate`** — MANDATORY before every `git push`, PR, or merge. Runs typecheck/lint/tests, verifies Dockerfile sync, monitors CI.
- **`/claim-ticket`** — before starting any GitHub issue or touching `shared/db/migrations/`. Reads `tasks/agent-collab.md` for Active Work and Migration Reservation.
- **`/deploy-gotchas`** — before touching Dockerfiles, nginx gateway, Fastify plugins, LLM adapters, or the DJ pipeline. Load-bearing incident fixes.
- **`/agent-ops`** — when running as a daemon-spawned agent, hitting a rate limit, or needing Telegram/checkpoint/L2-memory protocols.

## Self-Improvement Loop
1. Session start: read `tasks/lessons.md`.
2. On correction/mistake: append a rule (ALWAYS/NEVER) with `[category]` tag, trigger, why, example.
3. Before completion: review work against lessons.
4. Escalation: 1st → lessons.md, 2nd → CLAUDE.md Core Principles, 3rd → automated check (test/lint/hook).

## Task Tracking
Plan in `tasks/todo.md` (checkable items), mark progress, add review section on completion.

---

## Project: PlayGen

Multi-tenant microservices for automated radio station playlist generation (migrated from Excel/VBA). pnpm workspaces monorepo. Railway (services) + Vercel (frontend).

**Services** (Fastify + TS strict, Node 20): `auth :3001` · `station :3002` · `library :3003` · `scheduler :3004` · `playlist :3005` · `analytics :3006` · `dj` · frontend `:3000` (Next.js 14 App Router) · `gateway` (Nginx).

**Shared packages**: `@playgen/types`, `@playgen/middleware`, `@playgen/db` (migrations/seeds/PG client).

**Infra**: PostgreSQL 16 · BullMQ + Redis 7 (async playlist/DJ generation) · JWT auth · Docker multi-stage Alpine.

### Commands
```bash
pnpm --filter @playgen/<svc>-service dev      # service hot-reload
pnpm --filter @playgen/db migrate|seed
pnpm run typecheck|lint|test:unit|test:integration|build
docker-compose up --build -d                   # full stack
```

### Environment
`.env.example` lists all vars. Default admin: `admin@playgen.local` / `changeme`. Services use `DATABASE_URL`. Frontend needs `GATEWAY_URL` (proxy) + `NEXT_PUBLIC_API_URL` (browser).

### Invariants
- **Multi-tenancy**: every tenant-data query filters by `company_id` AND `station_id`.
- **Stateless JWT services** — no module-level mutable state.
- **LLM via OpenRouter only** (see `/deploy-gotchas`).
- **DJ review gate**: scripts pause at `pending_review`; never auto-TTS unless `dj_auto_approve=true`.
- **Migrations additive only**; new NOT NULL needs `DEFAULT`; JSONB needs `COMMENT ON COLUMN`.
