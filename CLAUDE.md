# PlayGen - CLAUDE.md

## Agent Intelligence & Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 4a. Mandatory Pre-PR Local Checklist (NON-NEGOTIABLE)
Before ANY `git push` or PR creation, run ALL of these in order. If any fails, fix it first:
```bash
pnpm run typecheck       # MUST pass — catches TS errors before CI does
pnpm run lint            # MUST pass — no lint violations
pnpm run test:unit       # MUST pass — unit tests green
```
If a Dockerfile was changed or a new workspace dependency added, also run:
```bash
docker build -f services/<svc>/Dockerfile . --no-cache 2>&1 | tail -5
```
Local tests must be 1:1 with GitHub Actions. If it passes locally, it MUST pass in CI.
When adding `"@playgen/X": "workspace:*"` to a service's deps, ALSO update its Dockerfile to COPY and build the package.

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how
- After EVERY git push, you MUST actively monitor the CI/CD pipeline status (e.g., using `gh run list` and `gh run view`). If the pipeline fails, diagnose the trace logs and resolve all issues autonomously until the build is perfectly green.

### 7. L2 Memory Integration (Qdrant)
- For every complex issue, architectural roadblock, or bug that is successfully resolved, you MUST embed the context, symptoms, and the applied fix into the L2 Vector Database (Qdrant).
- Use `KnowledgeBaseClient` to push a synthesized `MemoryEntry` into the `agent_insights` collection.
- This creates a permanent semantic immune system, ensuring future agents naturally retrieve the exact fix if identical tracebacks ever surface.

### 8. Agent Checkpoint Protocol
- After completing each task unit (merged PR, resolved issue, completed sub-task), write a checkpoint to `/state/{slot_id}-checkpoint.md`
- Checkpoint format: `## Checkpoint\nCompleted: [list]\nNext: [next task]\nState: [any relevant context]`
- On re-spawn after limit_hit, read your checkpoint file first and resume from where you left off

### 9. Telegram Report via File (not curl)
- NEVER embed the Telegram bot token in a shell command within your prompt output
- To send a Telegram message from an agent, write the message to `/state/{slot_id}-report.txt`
- The daemon will read this file at the next reset window and send the message via `tg_send()`

### 10. Migration Conflict Prevention
- Before merging any PR that touches `shared/db/migrations/`, check the Migration Reservation section in `tasks/agent-collab.md`
- If two open PRs claim the same migration number, close the older one with a comment explaining the conflict

## Task Management & Organization

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

---

## Self-Improvement Loop System

### How It Works

Every session begins and ends with a feedback cycle:

1. **Session Start**: Read `tasks/lessons.md` to load all known patterns and anti-patterns
2. **During Work**: When corrected by the user or when a mistake is caught:
   - Immediately append to `tasks/lessons.md` with date, context, and the rule
   - Categorize: `[architecture]`, `[testing]`, `[deployment]`, `[code-quality]`, `[process]`
   - Write the lesson as a **rule**, not a story (e.g., "ALWAYS do X" or "NEVER do Y")
3. **Before Completion**: Review your own work against all lessons in `tasks/lessons.md`
4. **Session End**: If new lessons were learned, ensure they are persisted

### Lesson Format

```markdown
## [category] Short title — YYYY-MM-DD

**Trigger**: What went wrong or what was corrected
**Rule**: The rule to follow going forward (ALWAYS/NEVER format)
**Why**: Root cause explanation
**Example**: Concrete code or command example if applicable
```

### Escalation Protocol

- 1st occurrence: Add lesson to `tasks/lessons.md`
- 2nd occurrence of same pattern: Promote to CLAUDE.md under Core Principles
- 3rd occurrence: Add automated check (test, lint rule, or pre-commit hook)

---

## Project Structure & Stack

### Architecture Overview

PlayGen is a **multi-tenant microservices system** for automated radio station playlist generation, migrated from Excel/VBA. Monorepo managed with **pnpm workspaces**.

```
playgen/
├── services/           # 6 Fastify microservices
│   ├── auth/          # JWT auth, RBAC, user management        :3001
│   ├── station/       # Company/station config                  :3002
│   ├── library/       # Song library, categories, XLSX import   :3003
│   ├── scheduler/     # Templates, playlist generation engine   :3004
│   ├── playlist/      # Playlist CRUD, export (XLSX/CSV)        :3005
│   └── analytics/     # Play history, rotation reports          :3006
├── frontend/          # Next.js 14 (App Router, Tailwind)       :3000
├── gateway/           # Nginx API gateway + CORS + rate limiting
├── shared/            # Monorepo shared packages
│   ├── db/           # Migrations (15 SQL), seeds, PG client
│   ├── types/        # Shared TypeScript interfaces
│   └── middleware/   # Fastify auth/RBAC middleware
├── docs/             # API spec, data model, testing strategy
├── scripts/          # Deployment helpers (SSL, VPS setup)
└── tasks/            # Todo tracking and lessons learned
```

### Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Node.js 20, TypeScript 5.4 (strict), Fastify 4.27 |
| **Frontend** | Next.js 14.2 (App Router), Tailwind CSS 3.4 |
| **Database** | PostgreSQL 16 |
| **Queue** | BullMQ + Redis 7 (playlist generation jobs) |
| **Auth** | JWT (access + refresh tokens), bcryptjs |
| **Gateway** | Nginx 1.25 (path-based routing, CORS, rate limiting) |
| **Containers** | Docker + Docker Compose (multi-stage Alpine builds) |
| **Package Manager** | pnpm 9.0 (workspace protocol) |
| **Testing** | Vitest 1.5 + Supertest 7.0 |
| **Deployment** | Railway (services) + Vercel (frontend) |

### Key Commands

```bash
# Full stack (Docker)
docker-compose up --build -d

# Individual service dev (hot-reload)
pnpm --filter @playgen/auth-service dev
pnpm --filter @playgen/scheduler-service dev
cd frontend && pnpm dev

# Database
pnpm --filter @playgen/db migrate
pnpm --filter @playgen/db seed

# Testing
pnpm run test:unit
pnpm run test:integration
pnpm run test:all
pnpm --filter @playgen/scheduler-service test

# Build & lint
pnpm run build
pnpm run lint
pnpm run typecheck
```

### Environment

- `.env.example` has all required vars (DB, Redis, JWT secrets, service ports)
- Default admin: `admin@playgen.local` / `changeme`
- Services use `DATABASE_URL` or individual `POSTGRES_*` vars
- Frontend needs `GATEWAY_URL` (internal proxy) and `NEXT_PUBLIC_API_URL` (browser-facing)

### Key Design Patterns

- **Multi-tenancy**: Row-level filtering via `company_id`/`station_id`
- **Stateless services**: JWT auth enables horizontal scaling
- **Async generation**: BullMQ offloads CPU-bound playlist generation
- **Shared packages**: `@playgen/types`, `@playgen/middleware`, `@playgen/db` via workspace protocol
- **Adapter pattern**: Export system supports XLSX, CSV, and future formats (RCS, Zetta)
- **JSONB flexibility**: Rotation rules and template overrides stored as JSON
