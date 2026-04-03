# Changelog

All notable changes to PlayGen are documented here.
Version format: `{major}.{minor}{fix}` (e.g. `1.01`)

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
