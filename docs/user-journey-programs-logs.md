# User Journey — Programs & Logs (unified)

> Supersedes `docs/user-journey-programs.md` (kept as historical reference for the Programs-only walkthrough).

## Why this doc exists

PlayGen shipped Programs and Playlists as two parallel concepts:

- **Programs** define *what* airs (recurring show, days, hours, Show Clock, DJ profile).
- **Playlists** define *what actually ran* on a given date (24-hour station log).

The two never meet in the UI:

1. Clocks exist under Programs but **do not drive generation** — logs are built from Templates.
2. There is no "now playing" view — board-ops can't see today's airtime at a glance.
3. You can't jump from a Playlist back to the Program that owns an hour, or from a Program back to the generated log for today.
4. Coverage gaps (hours with no Program) are invisible until a director notices silence on-air.

This doc defines the unified model, the new information architecture, and the three primary user journeys. It is the source of truth that every future ticket under this initiative must reference in its acceptance criteria.

---

## Mental model

Adopted from industry convention (RCS GSelector, Music Master, PowerGold):

```
Station Log (daily, per station)
  └── Program Bands (hourly blocks owned by a Program)
        └── Show Clock (60-min format wheel)
              └── Clock Slots → Library categories
```

- A **Log** is the concrete output for `(station, date)`. One per station per day. (DB: `playlists` table.)
- A **Program** is a recurring show definition. It owns hours and a default Clock. (DB: `programs`.)
- An **Episode** is a Program's slice of a specific Log (per-day metadata: DJ script, approval, notes). (DB: `program_episodes`.)
- A **Clock** is the hour-shaped rotation template. (DB: `show_format_clocks` + `show_clock_slots`.)
- **Templates** are demoted to "Default Clock Library" — the fallback used when no Program covers an hour.

No destructive schema migration is needed to ship the unified UI. The schema already supports this model; the UI just needs to surface it.

---

## Information architecture

Sidebar order (see `frontend/src/components/ClientLayout.tsx`):

1. **Today** — new landing for all personas
2. **Dashboard** — retained for company-wide KPIs
3. **Stations**
4. **Library**
5. **Programs** — shows + clocks (Program Director home)
6. **Logs** — renamed from "Playlists"; chronological daily logs
7. **Templates** — labelled "Default Clocks" eventually; unchanged for now
8. Users, Analytics, System Logs, Settings, Billing, Roles, Profile

---

## Personas & journeys

All three personas land on `/today`.

### Persona A — Program Director (setup loop)

**Goal**: make sure every hour of the week is owned by a Program with a tuned Clock.

1. Opens `/today`. Sees a 24-hour timeline with colored Program bands and a grey **"Uncovered 18:00–22:00"** band.
2. Clicks the uncovered band → `/programs/new?start_hour=18&end_hour=22` (query pre-fills form).
3. Names the show, picks a color, days, assigns (or creates) a Clock → saves.
4. Lands on `/programs/:id/clock`, edits slots, saves.
5. Returns to `/today`; the grey band is now colored. Done.

### Persona B — Music Director (rotation loop)

**Goal**: tune category rotation so no song is overplayed within a daypart.

1. `/today` → clicks "Today's Log" → `/playlists/:id` with program bands overlaid on the hour grid.
2. Notices the Morning Rush band shows a warning icon (from Analytics: category overplayed).
3. Clicks the band → jumps to `/programs/:id/clock` to retune slot categories.
4. Back to `/library` if songs need recategorization.

### Persona C — Board-op / on-air operator (daily loop)

**Goal**: know what's on air now, grab today's log, print or export.

1. `/today` → sees **Now Playing** card (current hour → active Program → DJ avatar/name if assigned → current clock slot), **Next Up** card, and a prominent "Open today's log" button. The DJ badge links to `/stations/:sid/dj`.
2. Clicks "Open today's log" → `/playlists/:id` with bands.
3. Reviews, approves, exports XLSX.

---

## Scope of the initial PR (navigational skeleton)

This PR ships the IA + empty states. It does **not** change the generation engine.

Files touched:

- `frontend/src/app/today/page.tsx` — NEW landing
- `frontend/src/components/ClientLayout.tsx` — add Today, rename Playlists→Logs
- `frontend/src/app/playlists/page.tsx` — H1 "Station Logs"
- `frontend/src/app/playlists/[id]/page.tsx` — program-band overlay on the hour grid
- `frontend/src/app/programs/[id]/episodes/page.tsx` — "Open in Log" link copy
- `e2e/programs-journey.mjs` — extends happy path to assert the `/today` data surface (today's playlist fetch via existing month endpoint)

## Out of scope (tracked as GitHub issues)

See the issues labelled `epic:programs-logs-unification`. Each ticket below is filed alongside this PR:

| ID | Priority | Title |
|----|----|----|
| T-A | P0 | Clocks drive playlist generation (`programs.default_clock_id`) |
| T-B | P0 | `GET /stations/:sid/playlists?date=YYYY-MM-DD` filter |
| T-C | P1 | Generate-day-from-Programs orchestration route |
| T-D | P1 | WebSocket/SSE now-playing channel (replaces polling) |
| T-E | P2 | Templates → "Default Clocks" copy + redirect pass |
| T-F | P2 | Log → Program backlink in Log header |
| T-G | P2 | `GET /playlists/:id/episodes` reverse endpoint |
| T-H | P2 | `useProgramCoverage(stationId, date)` hook + tests |
| T-I | P2 | ~~DJ profile surfaced on Today's Now Playing card~~ (done — #299) |
| T-J | P3 | Mobile responsive polish for `/today` |
| T-K | P3 | Timeline multi-day view (`?span=3`) |
| T-L | P3 | Coverage-gap auto-fix CTA |
| T-M | P3 | Archive old `user-journey-programs.md` |
| T-N | P3 | Gate `/playlists/new` manual creation behind advanced flag |

---

## Acceptance checklist (every ticket in this epic)

- [ ] Change is consistent with the mental model above
- [ ] This user journey doc is updated if the flow changes
- [ ] `e2e/programs-journey.mjs` extended if a new flow is introduced
- [ ] `pnpm run typecheck && pnpm run lint && pnpm run test:unit` all green locally before push
- [ ] Smoke-tested manually against `docker-compose up` stack
