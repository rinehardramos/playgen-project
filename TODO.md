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
- [ ] `P0` Station config: timezone, broadcast hours, active days
- [ ] `P1` Password reset flow (email link)
- [ ] `P1` User invite flow (email invite to join company/station)
- [ ] `P2` SSO / OAuth2 support — Google Workspace for company accounts (`@fastify/oauth2` + `googleapis`)
  - Use `passport-google-oauth20` or native OAuth2 PKCE flow (no axios dependency)
  - Store Google `sub` in users table alongside password_hash (nullable for OAuth-only accounts)
  - Scope: company-level login only (each company configures their own Google OAuth client ID)
  - Future: per-station OAuth restriction (only allow @companyname.com domain)

---

## User Management API & GUI

- [ ] `P0` **User Management REST API** (station-service — already stubbed, needs full implementation)
  - `GET /companies/:id/users` — list with role + station info
  - `POST /companies/:id/users` — create user (hash password, assign role + stations)
  - `GET /users/:id` — get user profile
  - `PUT /users/:id` — update role, stations, display_name, is_active
  - `DELETE /users/:id` — soft delete (set is_active = false)
  - `POST /users/:id/reset-password` — admin-triggered password reset
- [ ] `P0` **User Management GUI** (frontend — Next.js)
  - Users list page (filterable by role, station)
  - Create/Edit user drawer/modal
  - Role assignment dropdown (shows company's configured role labels)
  - Station multi-select (which stations does this user have access to)
  - Activate/Deactivate toggle
  - Admin password reset button
- [ ] `P1` Self-service profile page (user can update own display_name + password)
- [ ] `P1` User invite flow (generate invite link, user sets own password)
- [ ] `P2` Audit log for user management actions (who created/modified a user)

---

## Phase 2 — Song Library

- [ ] `P0` Category CRUD (per station)
- [ ] `P0` Song CRUD (per station, linked to company-shared pool)
- [ ] `P0` Song eligible slots management (per-song hour restrictions)
- [ ] `P0` Bulk import: parse PlayGen Encoder2.2.xlsm category sheets
  - Parse material format: `FGsA     Title - Artist {FGsA_4-FGsA_5-}`
  - Extract: title, artist, category code, eligible hours
- [ ] `P0` Seed script: import all ~600+ songs from PlayGen Encoder2.2.xlsm
- [ ] `P0` Import historical LOAD sheet data as play_history (for testing)
- [ ] `P1` Song search (title, artist, category) with pagination
- [ ] `P1` Song activation toggle (is_active flag — exclude from scheduling without deleting)
- [ ] `P1` Bulk song import via CSV upload (UI)
- [ ] `P1` Duplicate detection on import (same title + artist)
- [ ] `P2` Song duration tracking (for future time-accurate scheduling)
- [ ] `P2` Company-level song library view (shared songs across stations)

### TODO (Future)
- [ ] `P3` **Song Station Locking**: Allow a song to be locked to one or specific stations within a company, preventing it from appearing in other stations' libraries. Implement via `song_station_locks (song_id, station_id[])` table. Currently all songs at company level are shared freely across stations.

---

## Phase 3 — Template Builder

- [ ] `P0` Template CRUD (per station)
- [ ] `P0` Template slot definitions (hour × position × required_category)
- [ ] `P0` Support template types: 1-day, 3-hour, 4-hour (matching source file)
- [ ] `P0` Template visual builder UI (24-hour grid, assign category per slot)
- [ ] `P1` Clone template to another station (within same company)
- [ ] `P1` Per-day-of-week template overrides
  - Data model ready from day one (`day_of_week_overrides JSONB` on templates table)
  - MVP UI: one default template
  - Full UI: assign different templates per day of week (MON–SUN)
- [ ] `P2` Template validation (ensure all required hours are covered before activating)
- [ ] `P2` Import template structure from PlayGen Encoder2.2.xlsm template sheets

---

## Phase 4 — Scheduler & Playlist

- [ ] `P0` Playlist generation engine (slot filler algorithm)
  - Load template slots
  - Per slot: resolve eligible songs → apply rotation rules → pick least-recently-played
  - Assign song → write play_history
- [ ] `P0` BullMQ queue integration (async generation, job status polling)
- [ ] `P0` Manual playlist generation trigger (UI button: pick date + template)
- [ ] `P0` Cron-based auto generation (configurable schedule per station, default: daily 11PM for next day)
- [ ] `P0` Playlist viewer (read-only, matches iFM Manila output layout)
- [ ] `P0` Playlist editor: manual slot override (swap song, mark as override)
- [ ] `P0` Preserve manual overrides on re-generation (`is_manual_override = true`)
- [ ] `P0` Export playlist as XLSX (iFM Manila format)
- [ ] `P0` Export playlist as CSV
- [ ] `P1` Re-generate single slot without affecting rest of playlist
- [ ] `P1` Playlist status workflow: `draft` → `ready` → `approved` → `exported`
- [ ] `P1` Approval step before export (station_admin approves scheduler's playlist)
- [ ] `P1` Playlist diff view (compare auto-generated vs manual overrides)
- [ ] `P1` Generation failure alerting (notify station_admin on cron failure)
- [ ] `P2` Bulk generate (generate full week at once)
- [ ] `P2` Playlist copy (clone a past playlist to a new date as starting point)

---

## Phase 5 — Rotation Rules & Analytics

- [ ] `P0` Rotation rules config UI per station (edit `rules` JSONB)
  - `max_plays_per_day` (per song)
  - `min_gap_hours` (min hours between replays of same song)
  - `max_same_artist_per_hour`
  - `artist_separation_slots` (min slots between same artist)
  - `category_weights` (relative scheduling weight per category)
- [ ] `P0` Rotation dashboard: songs × recent days heatmap
- [ ] `P0` Overplayed songs report (songs exceeding rotation thresholds)
- [ ] `P0` Underplayed songs report (songs rarely/never scheduled)
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

- [ ] `P0` API versioning (`/api/v1/` prefix)
- [ ] `P0` Structured logging (JSON logs per service with request_id correlation)
- [ ] `P0` Health check endpoints per service (`GET /health`)
- [ ] `P1` OpenAPI/Swagger docs auto-generated per service
- [ ] `P1` Request ID propagation across services (tracing)
- [ ] `P1` Centralized error response format `{ error: { code, message, details } }`
- [ ] `P2` Metrics endpoint (Prometheus-compatible)
- [ ] `P2` Rate limiting per company/API key
- [ ] `P2` Audit log table (who changed what, when)
- [ ] `P3` Admin dashboard (super_admin: view all companies, usage stats)

---

## Testing

See [`docs/testing-strategy.md`](docs/testing-strategy.md) for full details.

- [ ] `P0` Unit tests for rotation algorithm (scheduler-service)
- [ ] `P0` Unit tests for XLSM import parser (library-service)
- [ ] `P0` Integration tests for playlist generation end-to-end
- [ ] `P0` Auth middleware tests (valid token, expired, wrong permissions)
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
