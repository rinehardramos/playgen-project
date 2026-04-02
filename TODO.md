# PlayGen — TODO & Feature Backlog

Format: `[PRIORITY]` `[PHASE]` Description

Priorities: `P0` = blocker / must-have MVP | `P1` = important | `P2` = nice-to-have | `P3` = future

---

## Phase 1 — Foundation

- [x] `P0` Set up monorepo structure (services/, frontend/, shared/, gateway/)
- [x] `P0` Configure Docker Compose with all services, PostgreSQL, Redis
- [x] `P0` Create `.env.example` with all required env vars documented
- [x] `P0` Write initial database migrations (all core tables)
- [x] `P0` Implement auth-service: login, refresh token, logout
- [x] `P0` Implement JWT middleware (validate + decode claims — `@playgen/middleware` shared package)
- [x] `P0` Implement company CRUD (super_admin only)
- [x] `P0` Implement station CRUD (company_admin)
- [x] `P0` Implement user CRUD with role assignment
- [x] `P0` Configurable role labels per company (code=`station_admin`, label="Music Director")
- [x] `P0` Station config: timezone, broadcast hours, active days — `GET/PUT /api/v1/stations/:id/config` (scheduler service) + Settings page UI
- [ ] `P1` Password reset flow (email link)
- [ ] `P1` User invite flow (email invite to join company/station)
- [ ] `P2` SSO / OAuth2 support — Google Workspace for company accounts (`@fastify/oauth2` + `googleapis`)
  - Use `passport-google-oauth20` or native OAuth2 PKCE flow (no axios dependency)
  - Store Google `sub` in users table alongside password_hash (nullable for OAuth-only accounts)
  - Scope: company-level login only (each company configures their own Google OAuth client ID)
  - Future: per-station OAuth restriction (only allow @companyname.com domain)

---

## User Management API & GUI

- [x] `P0` **User Management REST API** (station-service)
  - `GET /companies/:id/users` — list with role + station info (`role_label` from JOIN)
  - `POST /companies/:id/users` — create user (hash password, assign role + stations)
  - `GET /users/:id` — get user profile
  - `PUT /users/:id` — update role, stations, display_name, is_active
  - `DELETE /users/:id` — soft delete (set is_active = false)
- [x] `P0` **User Management GUI** (frontend — Next.js)
  - Users list page with role and station columns
  - Create/Edit user modal
  - Role assignment dropdown (shows company's configured role labels)
  - Station multi-select checkboxes
  - Activate/Deactivate toggle
- [ ] `P1` Self-service profile page (user can update own display_name + password)
- [ ] `P1` User invite flow (generate invite link, user sets own password)
- [ ] `P1` Admin password reset button
- [ ] `P2` Audit log for user management actions (who created/modified a user)

---

## Phase 2 — Song Library

- [x] `P0` Category CRUD (per station) — `GET/POST /stations/:id/categories`, `PUT/DELETE /categories/:id`
- [x] `P0` Song CRUD (per station) — `GET/POST /stations/:id/songs`, `PUT /songs/:id`
- [x] `P0` Song eligible slots management (per-song hour restrictions via `song_slots` table)
- [x] `P0` Bulk import: parse PlayGen Encoder2.2.xlsm category sheets (`importParser.ts`)
  - Parse material format: `FGsA     Title - Artist {FGsA_4-FGsA_5-}`
  - Extract: title, artist, category code, eligible hours
- [x] `P0` Seed script: `shared/db/src/seeds/playgen.ts` — import from XLSM (requires XLSM file + STATION_ID/COMPANY_ID env vars)
- [ ] `P0` Import historical LOAD sheet data as play_history (implemented in seed, not yet run)
- [x] `P1` Song search (title, artist) with pagination — `?search=&limit=` on `GET /stations/:id/songs`
- [x] `P1` Song activation toggle (`is_active` flag — deactivate without deleting)
- [x] `P1` Bulk song import via XLSM/CSV upload (UI + `POST /stations/:id/songs/import`)
- [ ] `P1` Duplicate detection on import (same title + artist)
- [ ] `P2` Song duration tracking (for future time-accurate scheduling)
- [ ] `P2` Company-level song library view (shared songs across stations)

### TODO (Future)
- [ ] `P3` **Song Station Locking**: Allow a song to be locked to one or specific stations within a company, preventing it from appearing in other stations' libraries. Implement via `song_station_locks (song_id, station_id[])` table. Currently all songs at company level are shared freely across stations.

---

## Phase 3 — Template Builder

- [x] `P0` Template CRUD (per station) — `GET/POST /stations/:id/templates`, `GET/PUT/DELETE /templates/:id`
- [x] `P0` Template slot definitions (hour × position × required_category) — `PUT /templates/:id/slots` (bulk), `PUT/DELETE /templates/:id/slots/:hour/:position`
- [x] `P0` Support template types: `1_day`, `3_hour`, `4_hour`
- [x] `P0` Template visual builder UI — 24-hour × 4-position grid, assign category per cell via dropdown
- [ ] `P1` Clone template to another station (within same company)
- [ ] `P1` Per-day-of-week template overrides
  - Data model ready from day one (`day_of_week_overrides JSONB` on templates table)
  - MVP UI: one default template
  - Full UI: assign different templates per day of week (MON–SUN)
- [ ] `P2` Template validation (ensure all required hours are covered before activating)
- [ ] `P2` Import template structure from PlayGen Encoder2.2.xlsm template sheets

---

## Phase 4 — Scheduler & Playlist

- [x] `P0` Playlist generation engine (slot filler algorithm in `generationEngine.ts`)
  - Load template slots → resolve eligible songs → apply rotation rules → pick least-recently-played
  - Assign song → write play_history
- [x] `P0` BullMQ queue integration (async generation, job status in `generation_jobs` table)
- [x] `P0` Manual playlist generation trigger (UI: pick date + template via `POST /scheduler/generate`)
- [x] `P0` Cron-based auto generation (configurable schedule per station via `cronService.ts`)
- [x] `P0` Playlist viewer — grouped by hour, entry table with category/title/artist columns
- [x] `P0` Playlist editor: manual slot override (song search + swap, `PUT /playlists/:id/entries/:hour/:position`)
- [x] `P0` Preserve manual overrides on re-generation (`is_manual_override = true`, highlighted in UI)
- [x] `P0` Export playlist as XLSX (iFM Manila format via `exportService.ts`)
- [x] `P0` Export playlist as CSV
- [ ] `P1` Re-generate single slot without affecting rest of playlist
- [x] `P1` Playlist status workflow: `draft` → `ready` → `approved` → `exported`
- [x] `P1` Approval step before export (`POST /playlists/:id/approve`, approve button in UI)
- [ ] `P1` Playlist diff view (compare auto-generated vs manual overrides)
- [ ] `P1` Generation failure alerting (notify station_admin on cron failure)
- [ ] `P2` Bulk generate (generate full week at once)
- [ ] `P2` Playlist copy (clone a past playlist to a new date as starting point)

---

## Phase 5 — Rotation Rules & Analytics

- [x] `P0` Rotation rules config UI per station — `GET/PUT /api/v1/stations/:id/rotation-rules` (scheduler service) + Settings page section with all four rule fields
- [x] `P0` Rotation dashboard: songs × recent days heatmap (`analyticsService.ts` + `/analytics` page)
- [x] `P0` Overplayed songs report (songs exceeding rotation thresholds)
- [x] `P0` Underplayed songs report (songs rarely/never scheduled)
- [ ] `P1` Per-song play history timeline
- [ ] `P1` Category distribution report (% of playlist per category per day)
- [ ] `P2` Rule validation warnings in playlist editor (flag if rotation rule violated)
- [ ] `P2` Rule presets (e.g., "Standard Rotation", "Heavy Rotation", "Seasonal")

---

## Phase 6 — Export Adapters (Future)

- [ ] `P3` Pluggable adapter interface: `export(playlist: Playlist): Buffer`
- [ ] `P3` RCS GSelector adapter
- [ ] `P3` NaturalPlay adapter
- [ ] `P3` Zetta adapter
- [ ] `P3` Webhook push (POST playlist JSON to external URL on generation)
- [ ] `P3` FTP/SFTP export (send file to broadcast system folder automatically)

---

## Platform & DevEx

- [x] `P0` API versioning (`/api/v1/` prefix on all routes via Next.js proxy rewrites)
- [x] `P0` Structured logging (JSON logs per service with request_id correlation)
- [x] `P0` Health check endpoints per service (`GET /health`)
- [x] `P1` Centralized error response format `{ error: { code, message } }` — all services consistent
- [ ] `P1` OpenAPI/Swagger docs auto-generated per service
- [ ] `P1` Request ID propagation across services (tracing)
- [ ] `P2` Metrics endpoint (Prometheus-compatible)
- [ ] `P2` Rate limiting per company/API key
- [ ] `P2` Audit log table (who changed what, when)
- [ ] `P3` Admin dashboard (super_admin: view all companies, usage stats)

---

## Testing

See [`docs/testing-strategy.md`](docs/testing-strategy.md) for full details.

- [x] `P0` Unit tests for rotation algorithm (scheduler-service) — 50 tests passing
- [x] `P0` Unit tests for XLSM import parser (library-service) — 31 tests passing
- [x] `P0` Auth middleware tests (valid token, expired, wrong permissions) — 11 tests passing
- [x] `P0` Unit tests for all services — 118 tests total across 6 services (auth: 11, station: 9, library: 31, scheduler: 50, analytics: 9, playlist: 8)
- [x] `P0` Integration tests for playlist generation end-to-end — `services/scheduler/tests/integration/generation.test.ts` (8 tests; run with `TEST_DATABASE_URL=... pnpm test:integration`)
- [ ] `P1` Integration tests for all REST endpoints (each service)
- [ ] `P1` E2E test: login → generate playlist → export XLSX
- [ ] `P2` Load test: concurrent playlist generation jobs
- [ ] `P2` Snapshot tests for XLSX export output

---

## Known Technical Debt / Deferred

- VBA macro behavior not fully captured (macros are not readable via pandas — inferred from data structure). Revisit if users report scheduling gaps.
- `xmas 24` sheet in PlayGen Encoder is a seasonal override — seasonal template support is deferred to P3.
- The `LOAD` sheet uses a 3052-row × 397-column matrix. Imported as flat `play_history` rows — the matrix format is not preserved (not needed for the web app's algorithm).
- `duplex`, `duplexB`, `x`, `pd` categories have ambiguous names — confirm meaning with original user before finalizing category labels.
- Frontend API error parsing fixed: backend returns `{ error: { code, message } }` (nested object); `apiFetch` and `postForm` both handle this correctly.
- `vitest.config.ts` in all 6 services has `resolve.alias` pointing `@playgen/types` and `@playgen/middleware` to `src/index.ts` (avoids needing built `dist/` locally).
