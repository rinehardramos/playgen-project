# PlayGen — Radio Playlist Generation System

A multi-tenant web application for automated radio station playlist scheduling. Migrated from Excel/VBA (`PlayGen Encoder2.2.xlsm`) to a stateless REST API microservice architecture.

## What It Does

PlayGen automates the creation of daily broadcast playlists for radio stations. It:
- Maintains a categorized song library (Foreign Golden Standards, Philippine OPM, 70s/80s/90s, Contemporary, etc.)
- Enforces per-station rotation rules (max plays per day, artist separation, eligible time slots per song)
- Fills scheduling templates with songs to produce a full day's playlist
- Tracks historical play data to prevent overplay and ensure variety
- Exports playlists in standard formats (XLSX matching the original iFM Manila output, CSV)

## Source Files

The system was reverse-engineered from two Excel workbooks:
- `PlayGen Encoder2.2.xlsm` — the scheduling engine (~600+ songs, 39 sheets, category libraries, templates, LOAD tracker)
- `iFM Manila - May 19 Tuesday 2015.xlsm` — sample output (a generated daily playlist for iFM Manila)

See [`docs/migration-plan.md`](docs/migration-plan.md) for the full analysis and migration rationale.

## Architecture

Stateless REST API microservices behind an API gateway. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for system diagrams.

| Service | Responsibility |
|---|---|
| `auth-service` | JWT auth, RBAC, user management |
| `station-service` | Company/station config, rotation rules |
| `library-service` | Song library, categories, bulk import |
| `scheduler-service` | Template management, playlist generation engine |
| `playlist-service` | Playlist CRUD, export, manual overrides |
| `analytics-service` | Play history, rotation reports |
| `dj-service` | AI DJ script generation, TTS, HLS playout, OwnRadio webhook |
| `frontend` | Next.js web UI |
| `gateway` | Nginx — routing, rate limiting, `/stream/*` → dj-service |
| `info-broker` | Audio sourcing via yt-dlp; deployed as a Railway service in the same project |

## Quick Start

```bash
# Prerequisites: Docker Desktop, Node.js 20+, pnpm
git clone git@github.com:rinehardramos/playgen-project.git
cd playgen-project
cp .env.example .env          # edit JWT secrets before production use

# Build and start everything (migrations + admin seed run automatically)
docker-compose up --build -d

# Open the app via the gateway
open http://localhost
```

**Default admin credentials** (seeded on first run):
| Field | Value |
|---|---|
| Email | `admin@playgen.local` |
| Password | `changeme` |

Override via `.env` before first run: `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

**Development (frontend hot-reload + individual services):**
```bash
pnpm install                          # install all workspace deps

# Start infrastructure
docker-compose up -d postgres redis

# Run each service in its own terminal
pnpm --filter @playgen/auth-service dev      # :3001
pnpm --filter @playgen/station-service dev   # :3002
pnpm --filter @playgen/library-service dev   # :3003
pnpm --filter @playgen/scheduler-service dev # :3004
pnpm --filter @playgen/playlist-service dev  # :3005
pnpm --filter @playgen/analytics-service dev # :3006
pnpm --filter @playgen/dj-service dev        # :3007

cd frontend && pnpm dev              # :3000 (Next.js with hot-reload)
```

**Seed from source Excel (optional — imports real song library):**
```bash
XLSM_PATH=/path/to/PlayGen\ Encoder2.2.xlsm \
STATION_ID=<uuid> COMPANY_ID=<uuid> \
pnpm --filter @playgen/db seed:playgen
```

## Project Structure

```
playgen/
├── README.md
├── ARCHITECTURE.md          # System design + Mermaid diagrams
├── TODO.md                  # Feature backlog + future work
├── LESSONS.md               # Lessons learned during development
├── docker-compose.yml
├── .env.example
├── docs/
│   ├── migration-plan.md    # Full analysis of source Excel files
│   ├── data-model.md        # Database schema reference
│   ├── api-spec.md          # All REST API endpoints
│   └── testing-strategy.md # Test approach and coverage targets
├── services/
│   ├── auth/
│   ├── station/
│   ├── library/
│   ├── scheduler/
│   ├── playlist/
│   └── analytics/
├── frontend/
├── gateway/
└── shared/
    ├── db/                  # Migrations, seeds
    └── types/               # Shared TypeScript interfaces
```

## Tech Stack

- **Frontend**: Next.js 14 (App Router, TypeScript, Tailwind CSS)
- **Services**: Node.js 20 + Fastify 4 (TypeScript strict)
- **Database**: PostgreSQL 16 (UUID PKs, pg-pool)
- **Queue**: BullMQ + Redis 7 (async playlist generation, concurrency 3)
- **Auth**: JWT (access 15 min + refresh 7 d), RBAC via permissions array
- **Containers**: Docker + Docker Compose (multi-stage alpine builds)
- **Export**: ExcelJS (XLSX output matching original iFM Manila format)
- **Monorepo**: pnpm workspaces (`shared/db`, `shared/types`, `shared/middleware`)

## Roles (MVP)

| Role | Scope | Capabilities |
|---|---|---|
| `super_admin` | Platform | Manage companies, all stations |
| `company_admin` | Company | Manage stations, users within company |
| `station_admin` | Station | Manage library, templates, rules, users |
| `scheduler` | Station | Generate and edit playlists |
| `viewer` | Station | Read-only access to playlists |

Role labels are configurable per company (e.g., `station_admin` can be labeled "Music Director").

## Contributing

See [`docs/testing-strategy.md`](docs/testing-strategy.md) for test requirements.
See [`LESSONS.md`](LESSONS.md) before starting a new feature — check if a similar problem was already solved.

## Status

See [`TODO.md`](TODO.md) for current backlog and [`LESSONS.md`](LESSONS.md) for known gotchas.
