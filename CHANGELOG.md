# Changelog

All notable changes to PlayGen are documented here.
Version format: `{major}.{minor}{fix}` (e.g. `1.01`)

---

## [1.25] - 2026-04-05

### Fixed
- **CD Pipeline**: Remove `--cwd frontend` from Vercel deploy command (re-introduced by another agent); Vercel dashboard already has `Root Directory: frontend` configured so `--cwd frontend` caused a doubled `frontend/frontend` path error

---

## [1.23] - 2026-04-05

### Fixed
- **CD Pipeline**: Switch Vercel `installCommand` from `npm install` to `pnpm install --frozen-lockfile` and `buildCommand` to `pnpm run build` to match the pnpm monorepo setup and fix Vercel production deploy failures
- **Vercel pnpm module resolution**: Add root `.npmrc` with `shamefully-hoist=true` so pnpm hoists all packages to root `node_modules`, allowing `@tailwindcss/postcss` and other devDependencies to be resolved correctly during Vercel's monorepo build; remove `--cwd frontend` from `vercel deploy` command

---

## [1.22] - 2026-04-05

### Added
- **Dashboard Stats Endpoint**: `GET /api/v1/dashboard/stats` on analytics service returns `active_songs`, `todays_playlists`, `pending_approvals`, and `active_stations` in a single query, scoped to the caller's company; fixes 500 errors on the dashboard stats cards (#118)

### Fixed
- **Vercel CD doubled path**: Removed `working-directory: frontend` from Vercel deploy step in `cd.yml` to fix doubled `frontend/frontend` path causing deploy failures (#119)
- **Vercel CD missing cwd**: Added `--cwd frontend` to `vercel deploy` command so the CLI resolves the correct project root after the `working-directory` removal

---

## [1.21] - 2026-04-04

### Added
- **DJ Profile UI**: Full CRUD management for DJ personas — name, personality, voice, persona_config (catchphrases, energy/humor sliders, formality, backstory), TTS provider/voice, default flag (#114)
- **DJ Script Review UI**: Enhanced script review with per-segment editing, TTS regeneration button per segment, approve/reject workflow (#115)
- **DJ Storage & Audio**: Structured audio file management for generated segments; audio stored to `/tmp/dj-audio/:script_id/:position.mp3` with DB-backed URL tracking (#111)
- **DJ Manifest Service**: Builds ordered show manifests from approved segments for continuous playback; integrated into generation pipeline as fire-and-forget step (#112)
- **DJ Script Templates UI**: Manage per-station prompt templates per segment type (#116)
- **Clone Template**: Clone a scheduling template to another station (#107)
- **Default DJ Persona Seed**: New stations automatically get DJ "Alex" profile + 5 daypart assignments on creation (#117)
- **Per-song Play History Timeline**: Analytics timeline view for individual song play history (#109)

### Fixed
- **All API calls broken in Next.js 15 upgrade**: `url` variable undefined in API proxy route (`/api/v1/[...path]/route.ts`) — should be `targetUrl`; this caused Generate button and all frontend API calls to fail (#110)
- **High vulnerabilities**: Next.js 14→15, Fastify 4→5, `tar` and `esbuild` overrides; `@fastify/sensible` and `@fastify/rate-limit` upgraded for Fastify 5 compatibility (#110)
- **Fastify 5 setErrorHandler**: `err` typed as `unknown` — added explicit `FastifyError` import and type annotation across all 7 services (#110)

---

## [1.20] - 2026-04-04

### Added
- **AI DJ Service**: New `dj-service` microservice (port 3007) — OpenRouter LLM script generation, pluggable TTS adapters, BullMQ pipeline, DJ persona profiles, daypart assignments, script review workflow (approve/reject/edit), auto-approve toggle per station
- DB migrations 016–022: `dj_profiles`, `dj_daypart_assignments`, `dj_script_templates`, `dj_scripts`, `dj_segments`, `dj_show_manifests`, `stations.dj_auto_approve/dj_enabled`
- Default DJ persona "Alex" seed (auto-created on migration)
- DJ types added to `@playgen/types`
- nginx gateway route `/api/v1/dj/*` → dj-service
- **CI/CD Pipeline**: GitHub Actions automation
  - `ci.yml` — lint, typecheck, unit tests, security audit, Docker build verification on every PR and push to main
  - `cd.yml` — GHCR image push, Supabase DB migration, Vercel frontend deploy, Railway service deploy, post-deploy smoke tests
  - `security.yml` — weekly CodeQL analysis, dependency review on PRs, TruffleHog secret scanning, OWASP dependency audit
- `scripts/smoke-test.sh` — post-deploy health check script
- `Makefile` — local Docker build commands (`make build-all`, `make up`, `make down`)

### Removed
- `.github/workflows/deploy.yml` — legacy VPS SSH deploy (replaced by `cd.yml`)

### Changed
- `frontend/vercel.json` — disabled git auto-deploy (now handled by CD workflow)
- `docker-compose.yml` — added dj-service container
- `shared/db/src/migrate.ts` — seeds DJ persona after admin seed

---

## [1.01] - 2026-04-03

### Fixed
- **Generation engine**: wrong column reference `song_slots.hour` → `song_slots.eligible_hour` caused all playlist generation to fail
- **Generation engine**: `play_history` INSERT included non-existent `playlist_id` column, causing transaction rollback
- **Playlists page**: ISO timestamp dates (e.g. `2026-04-01T00:00:00.000Z`) not matching `YYYY-MM-DD` day keys — playlists showed `+ Generate` instead of their real status
- **Playlist detail page**: appending `T00:00:00` to an already-full ISO timestamp produced `Invalid Date` in the header
- **Login**: JWT did not include `display_name`/`email` — sidebar user info threw `toUpperCase on undefined`; fixed by persisting full user profile to `sessionStorage` on login
- **Login**: frontend expected flat `access_token` but API returns `tokens.access_token` nested object
- **Login**: `role_code` JWT claim read as `role`, causing auth checks to fail
- **API error parsing**: nested `{ error: { message } }` format not handled, showing blank error messages
- **Template builder**: fetched a non-existent `/templates/:id/slots` endpoint; slots are embedded in `GET /templates/:id`
- **Template builder**: category field name `name` → `label` to match API response
- **Song library**: `songs.filter is not a function` — API returns paginated `{ data, meta }`, not a plain array
- **Layout**: React hydration mismatch from `showNav = !!user && !isLoginPage`; changed to pathname-only check
- **Layout**: `useEffect is not defined` in Sidebar — missing import alongside `useState`
- **CORS**: nginx gateway missing `Access-Control-Allow-Origin` headers, blocking all browser API requests

### Added
- Per-day `+ Generate` button on each row of the playlists calendar
- Real-time status polling after generation (2 s interval, stops on terminal state)
- Generate Month progress bar showing completed / total jobs

---

## [1.00] - 2026-04-02

### Added
- Multi-tenant radio playlist management for broadcast stations
- Station management with per-station song libraries
- Song library with manual entry and XLSM bulk import
- Category system with per-station category definitions
- Template builder — visual hourly slot grid (24 h × 4 positions) with category assignment
- Playlist generation engine (BullMQ) with relaxation tiers for sparse libraries
- Artist separation and gap-constraint rotation rules
- Manual song override per playlist entry
- Playlist approval workflow (`draft → ready → approved → exported`)
- XLSX and CSV playlist export
- User management with role-based access (`super_admin`, `station_admin`, `operator`)
- Dashboard overview with station and playlist stats
- Analytics page
- Dark-theme Next.js 14 frontend (App Router)
- Fastify microservice backend (auth, library, scheduler, playlist, station, analytics)
- PostgreSQL 16 + Redis 7 + BullMQ infrastructure
- nginx reverse-proxy gateway with JWT auth forwarding

---

## [1.02] - 2026-04-03

### Added
- `frontend/Dockerfile` — multi-stage Next.js standalone build (deps → builder → runner)
- `frontend/.dockerignore` — excludes node_modules/.next from build context
- `frontend` Docker Compose service — frontend now runs as a container alongside the API services
- nginx `resolver 127.0.0.11` + `set $fe_upstream` — deferred DNS resolution so gateway starts before frontend without errors
- nginx catch-all `location /` — proxies all non-API traffic to the Next.js frontend container; port 80 now serves the full app
- `docker-compose.prod.yml` — production overrides: no exposed DB/Redis ports, memory limits, `restart: always`
- `.github/workflows/deploy.yml` — GitHub Actions CD: triggers on version tags, SSHes into VPS, builds and redeploys
- `scripts/setup-vps.sh` — one-time Ubuntu/Debian VPS bootstrap (Docker install, deploy user, repo clone)
- `scripts/setup-ssl.sh` — Let's Encrypt SSL setup via Certbot with nginx HTTPS server block

---

## [1.03] - 2026-04-03

### Added
- **Vercel deployment**: `vercel.json` at repo root — sets `rootDirectory: frontend`, auto-deploys on push to `main`
- **Railway deployment**: `railway.toml` in each service directory (`gateway`, `auth`, `station`, `library`, `scheduler`, `playlist`, `analytics`) — configure Root Directory to repo root + Config Path to service path in Railway dashboard
- **Supabase / managed Postgres**: `shared/db/src/client.ts` now accepts `DATABASE_URL` env var with automatic SSL (`rejectUnauthorized: false`); falls back to individual `POSTGRES_*` vars for local dev
- **Railway Redis / Upstash**: scheduler `queueService.ts` now accepts `REDIS_URL` env var; falls back to `REDIS_HOST` + `REDIS_PORT`
- **nginx env-var template**: `gateway/nginx.conf` converted to `nginx.conf.template`; upstream hostnames injected via `AUTH_HOST`, `STATION_HOST`, etc. — works locally (Docker service names) and on Railway (`*.railway.internal`)
- **Production CORS**: `ALLOWED_ORIGIN` env var on gateway allows Vercel app origin alongside localhost
- Updated `.env.example` with cloud service connection string examples and Railway dashboard instructions

---

## [1.04] - 2026-04-03

### Added
- `frontend/src/app/settings/page.tsx` — settings page
- `frontend/src/app/stations/page.tsx` — stations management page
- `frontend/src/app/ClientShell.tsx` — client-side shell component
- `shared/db/src/seeds/dev-sample.sql` — idempotent dev sample seed (categories, songs, templates for Test Station)
- `services/scheduler/src/routes/config.ts` — rotation-rules and station config REST routes extracted into dedicated router
- `services/scheduler/tests/integration/generation.test.ts` — integration test for playlist generation engine
- Unit tests: `authService.test.ts`, `jwtService.test.ts`, `songService.test.ts`, `exportService.test.ts`, `analyticsService.test.ts`
- `vitest.config.ts` added to analytics, playlist, auth, library, station, scheduler services
- `pnpm-lock.yaml` committed for reproducible installs

### Changed
- `services/analytics/package.json` — add `vitest` dev dependency, `test` and `test:unit` scripts
- `services/scheduler/package.json` — add `test:unit` and `test:integration` split scripts
- `services/auth/vitest.config.ts` — add path aliases for shared workspace packages

---

## [1.05] - 2026-04-03

### Fixed
- All 6 service-level `db.ts` files now support `DATABASE_URL` env var with SSL (Supabase / Railway Postgres); previously only `shared/db/src/client.ts` was updated, leaving all services using hardcoded `POSTGRES_*` vars
- `gateway/Dockerfile` — added explicit `EXPOSE 80` so Railway correctly detects the gateway port
- `services/scheduler/Dockerfile` — removed duplicate `EXPOSE 3004 3005`; now exposes only `3004`
- `gateway/railway.toml`, `services/station/railway.toml`, `services/scheduler/railway.toml` — refreshed for Railway service creation

---

## [1.06] - 2026-04-03

### Changed
- Production domain set to `www.playgen.site`
- `frontend/src/app/playlists/[id]/page.tsx` — export link base URL falls back to `''` (relative URL) instead of `http://localhost`; set `NEXT_PUBLIC_API_URL=https://www.playgen.site` in Vercel for absolute export links
- `.env.example` — updated `NEXT_PUBLIC_API_URL` and `ALLOWED_ORIGIN` examples to use `www.playgen.site`
- `gateway/nginx.conf.template` — updated `ALLOWED_ORIGIN` comment to reference `www.playgen.site`

---

## [1.07] - 2026-04-03

### Added
- `frontend/.env.development` — local dev gateway URL config (`GATEWAY_URL=http://localhost`)

### Changed
- `.gitignore` — added `*.tsbuildinfo` to exclude TypeScript build artifacts

---

## [1.08] - 2026-04-03

### Removed
- All `railway.toml` files (`gateway/`, `services/*/`) — Railway only reads `railway.toml` at the root of each service's configured directory; subdirectory toml files are never auto-detected. Services are now configured entirely through the Railway dashboard (Builder: Dockerfile, Dockerfile Path set per service).

---

## [1.09] - 2026-04-03

### Fixed
- `gateway/Dockerfile` — `COPY nginx.conf.template` → `COPY gateway/nginx.conf.template` (build context is repo root on Railway; relative path must include subdirectory)
- `docker-compose.yml` gateway — `context: ./gateway` → `context: .` + `dockerfile: gateway/Dockerfile` (aligns local and Railway build contexts)

---

## [1.13] - 2026-04-03

### Fixed
- `gateway/docker-start.sh` — prefer IPv4 nameserver but fall back to IPv6 (wrapped in nginx brackets `[addr]`) when only IPv6 is available; Railway containers expose their private DNS as `fd12::10` (IPv6) which is the only resolver that can resolve `.railway.internal` hostnames

---

## [1.12] - 2026-04-03

### Fixed
- `gateway/Dockerfile` — replaced nginx template entrypoint mechanism with a custom `docker-start.sh` CMD; `/docker-entrypoint.d/` scripts run in subshells and cannot export env vars to subsequent scripts, so `DNS_RESOLVER` was never available to `envsubst`
- `gateway/docker-start.sh` — auto-detects DNS resolver from `/etc/resolv.conf` at startup, exports it, then runs `envsubst` with an explicit variable list before starting nginx; works on both Docker Compose (`127.0.0.11`) and Railway (cluster DNS)
- Removed hardcoded `DNS_RESOLVER=127.0.0.11` from Railway gateway env vars (Docker-only value that fails on Railway)

---

## [1.11] - 2026-04-03

### Fixed
- `gateway/nginx.conf.template` — removed static `upstream {}` blocks which caused nginx to resolve `.railway.internal` hostnames at startup (before Railway's internal DNS is ready); replaced with `set $svc http://HOST:PORT` + `proxy_pass $svc` pattern on every location so all DNS resolution is deferred to request time
- `gateway/Dockerfile` — added `10-detect-dns.sh` entrypoint script that auto-detects the container DNS resolver from `/etc/resolv.conf` at startup; removes dependency on hardcoded `DNS_RESOLVER=127.0.0.11` which only works in Docker Compose

---

## [1.10] - 2026-04-03

### Fixed
- `vercel.json` — removed invalid `rootDirectory` property (must be set in Vercel dashboard project settings, not in config file)
- Moved `vercel.json` from repo root to `frontend/vercel.json` — Vercel reads config relative to the configured Root Directory (`frontend`)

### Added
- Database migrations applied to Supabase (all 15 migrations + default admin seed)
- Railway shared variable `DATABASE_URL` updated to use Supabase transaction pooler URL (`aws-1-ap-northeast-1`, port 6543)
- `REDIS_URL` set on Railway scheduler service (Upstash)
- Public Railway domain generated for gateway: `gateway-production-db99.up.railway.app`
- All 7 Railway services redeployed with working `DATABASE_URL` + `REDIS_URL`
