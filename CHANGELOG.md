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
