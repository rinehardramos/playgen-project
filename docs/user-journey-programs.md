# User Journey — Programs

> **Purpose**: end-to-end walkthrough of the *Program → Show Clock → Episode → Playlist/DJ Script* flow, as a staff UX + engineering reference and as the script for manual QA.
>
> **Actor**: Station Manager "Sam", logged in as admin on a single-station company.
>
> **Entry point**: `/programs` (via sidebar → Programs).

---

## 1. Why Programs exist

Programs are the **higher-tier entity** that groups recurring daily shows ("Morning Rush", "Afternoon Drive") with:

- a weekly schedule (`active_days` + `start_hour`/`end_hour`)
- one or more **Show Clocks** — the 60-minute content format (songs / DJ talk / weather / jokes / ads)
- a per-day instance called an **Episode**, which binds a `playlist_id` (music) and a `dj_script_id` (talk) for a specific `air_date`

Every station seeds a hidden `is_default` program ("Unassigned") so pre-existing playlists aren't orphaned.

---

## 2. Happy Path — 9 steps

### Step 1 — Land on `/programs`
**Expect**: list of named programs (cards), plus an "Unassigned" section for default. Station selector appears when >1 station. CTA `New Program` top-right.

**API**: `GET /api/v1/stations` → `GET /api/v1/stations/:stationId/programs`

### Step 2 — Click `New Program` → `/programs/new`
**Expect**: form with name, color swatch, description, day-of-week toggles (Mon–Fri preselected), start/end hour, optional music template.

**API**: `GET /api/v1/companies/:companyId/stations`, `GET /api/v1/stations/:stationId/templates`

### Step 3 — Fill + submit "Morning Rush" (Mon–Fri, 06:00–10:00)
**Expect**: `POST /api/v1/stations/:stationId/programs` returns 201, redirects to `/programs/:id/clock`.

### Step 4 — Empty-state clock screen
**Expect**: "No Show Clock yet" illustration + `Create Standard Hour Clock` button.

**API on click**: `POST /api/v1/programs/:id/clocks` with `{ name: 'Standard Hour', is_default: true, slots: [] }`

### Step 5 — Editing the clock
- Add ~8 slots: Station ID → Song → Song → DJ intro → Song → Weather → Song → Song
- Set `target_minute` and `duration_est_sec`
- Preview bar updates live with colored proportional segments
- Click **Save Clock** → `PUT /api/v1/programs/:id/clocks/:clockId`

### Step 6 — Back to `/programs/:id` overview
**Expect**: `Overview` tab shows the saved clock preview bar + first 8 slots, plus a "Program Info" card (schedule / duration / status).

**API**: `GET /api/v1/programs/:id`, `GET /api/v1/programs/:id/clocks`

### Step 7 — Episodes tab
Click **Episodes** tab (month-scoped).

**Expect**: either a list of episodes (cross-referenced with playlists for status badge) or an empty state linking to `/playlists` for generation.

**API**: `GET /api/v1/programs/:id/episodes?month=YYYY-MM` + `GET /api/v1/stations/:stationId/playlists?month=YYYY-MM`

### Step 8 — Drill into an Episode
Click **View →** on an episode row.

**Expect**: `/programs/:id/episodes/:episodeId` — episode detail with playlist link + DJ script link, status transitions (draft → ready → approved → aired), Publish action.

**API**: `GET /api/v1/program-episodes/:episodeId`, `POST /api/v1/program-episodes/:episodeId/publish`

### Step 9 — Settings tab → Edit / Deactivate / Delete
**Expect**: name/description/is_active edits via `PUT /api/v1/programs/:id`; Delete re-homes episodes to Unassigned via `DELETE /api/v1/programs/:id`. Default program renders "cannot be edited or deleted".

---

## 3. Secondary flows

| Flow | Path | Notes |
|---|---|---|
| Multi-clock per program | `/programs/:id/clock` → `+ Add clock` | e.g. "Weekend Hour" with `applies_to_hours = [6,7,8]` |
| Reassign episode | Episode detail → change `program_id` | Default program is the "inbox" |
| Template linkage | `new program` form `Music Template` select | Pre-wires rotation template for episode generation |

---

## 4. Error & edge cases to verify

1. `end_hour <= start_hour` → inline error before submit ✅ (client-side guard)
2. Empty name → inline error ✅
3. 401 anywhere → redirect to `/login` ✅ (via `getCurrentUser`)
4. 404 on program id → fallback `router.push('/programs')` ✅
5. Delete default program → 404 from API (server guard)
6. Saving a clock with 0 slots → allowed (empty clock is valid)

---

## 5. Acceptance criteria for the flow

- [ ] Can create a program end-to-end without leaving the Programs sub-tree
- [ ] Show Clock editor saves and reloads without data loss
- [ ] Episodes tab correctly joins `program_episodes` ↔ `playlists`
- [ ] Navigation back-buttons never land on an unrelated route
- [ ] All error states are recoverable (no dead ends)
- [ ] Empty states always provide a next action

---

## 6. Walkthrough results (QA pass — 2026-04-06)

Actor: Admin super_admin via Claude-in-Chrome against local Docker stack (commit `b38d91d`, worktree `confident-solomon`).

### Blockers (P0 — walkthrough could not complete)

| # | Where | Symptom | Root cause |
|---|---|---|---|
| B1 | Migration runner | Later migrations silently skipped; features ship unusable on fresh DB | `migrate.ts` uses `file.split('_')[0]` as version key — duplicate 3-digit prefixes collide, second file is `[skip]`'d. Affects 025, 030, 031, 033, 034, 040, 041, 044. Fix in this PR: use full filename as version + backfill legacy numeric rows. |
| B2 | `shared/db/src/migrations/` | 8 numeric prefixes have 2+ files. Two files even declare the same `programs` table with conflicting schemas (`034_create_programs.sql` vs `040_create_programs.sql`). | No reservation discipline. Deleted the stale `034_create_programs.sql` in this PR. |
| B3 | `026_add_unique_to_manifests.sql` | Errors `column "script_id" does not exist` on any DB where `025_create_station_settings.sql` was skipped. Also duplicates a unique already declared in 021. | Wrong column name + redundant migration. Not fixed in this PR — see ticket. |
| B4 | `044_backfill_default_programs.sql` | `ON CONFLICT (playlist_id) DO NOTHING` fails planner check — no unique constraint on `playlist_id`. | Replaced with idempotent `WHERE NOT EXISTS` in this PR. |
| B5 | `services/auth/src/services/emailService.ts` | Auth service crash-loops at startup when `RESEND_API_KEY` is unset. `new Resend('')` throws at module load. | Fallback to stub key so module can import. Real fix is lazy-init. |
| B6 | `frontend/Dockerfile` | `Cannot find module '/app/server.js'` — Next.js monorepo standalone emits `server.js` under `./app/`. | Added `cp -r ./app/. ./` hoist step in this PR. |
| B7 | `gateway/nginx.conf` | `GET /api/v1/programs/:id` and `/programs/:id/clocks` return **502** — no location block routes top-level `/api/v1/programs/` to `station-service`. Makes every Program detail, Show Clock editor, and Episode screen non-functional end-to-end. | Missing nginx `location ~ ^/api/v1/programs/` entry. |
| B8 | `frontend/src/app/programs/page.tsx:129` | `GET /api/v1/stations` returns **404** — the endpoint doesn't exist; station-service only exposes `/companies/:companyId/stations`. Programs list never loads stations → always renders empty state even when programs exist. | Frontend should call `/api/v1/companies/:companyId/stations`. |

### High-severity UX / workflow bugs

| # | Where | Issue |
|---|---|---|
| U1 | `/programs/new` | If the user has 0 stations, the form shows NO station picker but silently 422s on submit with an inline "Please select a station" — a dead end. |
| U2 | Sidebar | **Stations has no sidebar entry.** Stations live at `/stations` but are unreachable via nav — users can't discover where to create the prerequisite for Programs. |
| U3 | `/dashboard` | Top-of-page red "Bad Gateway" alert with no actionable text — dashboard-stats endpoint is failing. |
| U4 | `/programs` | List page hits `/api/v1/stations` (404) silently via `.catch(() => {})`; users never see a loading or error state. |
| U5 | `/programs/[id]/episodes/page.tsx` | Frontend calls `/api/v1/stations/:stationId/programs/:programId` and `/episodes` — but backend only exposes `/api/v1/programs/:id` and `/api/v1/programs/:id/episodes`. This route is **broken on every click** of the "View Episodes" card action. |
| U6 | `/programs/new` | Calls `/api/v1/companies/:companyId/stations` while `/programs` calls `/api/v1/stations` — inconsistent station-fetching endpoints across the same feature tree. |
| U7 | `/programs/new` | After successful POST returns `{ id }`, the page redirects to `/programs/:id/clock`, which then 502s because of B7. User sees a blank crash. |

### Medium / Low

- M1 — Empty state on `/programs` mentions "Morning Rush / Afternoon Drive" but doesn't tell the user they need a Station first.
- M2 — `active_days` toggles on `/programs/new` show Mon–Fri preselected but there is no "weekdays / weekends / all" preset.
- M3 — `ProgramCard` shows three buttons (View Episodes, Edit Clock, gear) — the gear-only "edit settings" affordance is not obvious.
- M4 — `formatHour(24)` in program card displays "12:00 AM" for both 0 and 24 hour — indistinguishable "midnight" vs "next-day-midnight".
- M5 — Show Clock editor "Min" (target minute) accepts values outside 0–59 without blocking save.
- M6 — Deleting a non-default program shows a `window.confirm()` — should be an in-app modal matching the design system.

### Improvement ideas

- I1 — When on `/programs` with 0 stations, redirect to a combined "Create your first station + first program" wizard.
- I2 — Surface a station-scoped breadcrumb on every Programs page.
- I3 — The Show Clock editor preview bar is great; add a "total duration" readout next to it (60:00 target).
- I4 — Add "clone clock" and "clone program" actions for quick setup.
- I5 — Program detail Episodes tab should deep-link to the Playlists generator with station + date pre-filled.

### Test coverage

Playwright specs live at `e2e/programs.spec.ts` covering:

1. Login → land on `/programs` with no stations → empty state contains a link to create a station.
2. Create station → create program → open Show Clock editor → add 1 slot → save → reload and assert the slot persists.
3. Delete program from Settings tab → assert redirect to `/programs`.
4. Unauthenticated visit to `/programs` → redirects to `/login`.

The suite is wired into `pnpm run test:e2e` and runs against `http://localhost` in CI.

