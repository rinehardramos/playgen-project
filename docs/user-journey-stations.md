# User Journey — Stations

> **Purpose**: end-to-end walkthrough of discovering and managing Stations from the sidebar.
>
> **Actor**: Station Manager "Sam", logged in as admin on a fresh company with no stations.
>
> **Entry point**: `/dashboard` (post-login landing page).

---

## 1. Why Stations are the starting point

Every Program, Library song, and Playlist in PlayGen belongs to a Station. Before any other content can be created, at least one Station must exist. The sidebar's **Stations** link (between Dashboard and Library) is the entry point for this setup step.

---

## 2. Happy Path — 4 steps

### Step 1 — Click **Stations** in sidebar → `/stations`

Click **Stations** in the sidebar (between Dashboard and Library). It is highlighted with the violet active state when on any `/stations` route.

**Expect**: list of existing stations (or empty state "No stations yet") plus a `New Station` CTA.

**API**: `GET /api/v1/companies/:companyId/stations`

### Step 2 — Click `New Station` → create form

Fill in station name, call sign, frequency/genre, timezone.

**API**: `POST /api/v1/companies/:companyId/stations`

### Step 3 — Station created → station detail page

**Expect**: redirect to `/stations/:stationId` showing the station card with edit/delete affordances.

### Step 4 — Return to `/programs` → station selector now populated

With a station in place, the Programs list page can show the station selector and allow Program creation.

---

## 3. Keyboard navigation

The Stations `<a>` element is part of the sidebar `<nav>`. Standard Tab/Enter keyboard navigation reaches it. No custom JS required.

---

## 4. Acceptance criteria

- [x] Stations link present in sidebar between Dashboard and Library
- [x] Link is highlighted (violet active state) when pathname is `/stations` or `/stations/*`
- [x] Keyboard navigation (Tab) reaches the Stations link
- [x] User can reach `/stations` without typing the URL
