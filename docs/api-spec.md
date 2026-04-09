# PlayGen — REST API Specification

**Base URL**: `/api/v1`
**Auth**: `Authorization: Bearer <access_token>` on all protected endpoints
**Content-Type**: `application/json`

**Standard error response**:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": {}
  }
}
```

---

## Auth Service (`/api/v1/auth`)

| Method | Path | Description | Auth Required |
|---|---|---|---|
| POST | `/auth/login` | Login, returns access + refresh tokens | No |
| POST | `/auth/refresh` | Rotate refresh token, returns new tokens | No (refresh token in body) |
| POST | `/auth/logout` | Revoke refresh token | Yes |
| POST | `/auth/forgot-password` | Send password reset email | No |
| POST | `/auth/reset-password` | Set new password via reset token | No |

### POST `/auth/login`
```json
// Request
{ "email": "user@station.com", "password": "secret" }

// Response 200
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "user": {
    "id": "uuid",
    "display_name": "John Doe",
    "email": "user@station.com",
    "role": { "code": "station_admin", "label": "Music Director" },
    "company_id": "uuid",
    "station_ids": ["uuid"]
  }
}
```

---

## Company & Station Service (`/api/v1`)

### Companies
| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/companies` | `super_admin` | List all companies |
| POST | `/companies` | `super_admin` | Create company |
| GET | `/companies/:id` | `company:read` | Get company |
| PUT | `/companies/:id` | `company:write` | Update company |
| DELETE | `/companies/:id` | `super_admin` | Delete company |

### Stations
| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/companies/:id/stations` | `station:read` | List stations for company |
| POST | `/companies/:id/stations` | `company_admin` | Create station |
| GET | `/stations/:id` | `station:read` | Get station |
| PUT | `/stations/:id` | `station:write` | Update station config |
| DELETE | `/stations/:id` | `company_admin` | Delete station |
| GET | `/stations/:id/config` | `station:read` | Get full config (rules, template, schedule) |

### Users
| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/companies/:id/users` | `users:read` | List company users |
| POST | `/companies/:id/users` | `users:write` | Create user |
| GET | `/users/:id` | `users:read` | Get user |
| PUT | `/users/:id` | `users:write` | Update user (role, stations, display_name) |
| DELETE | `/users/:id` | `users:write` | Deactivate user |
| POST | `/users/:id/invite` | `users:write` | Send invite email |

### Roles
| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/companies/:id/roles` | `users:read` | List configurable roles |
| PUT | `/roles/:id` | `company_admin` | Update role label |

### Programs
**Gateway owner**: Station service (`station :3002`). Nginx routes `/api/v1/programs/*` and `/api/v1/program-episodes/*` → station.

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/stations/:id/programs` | `station:read` | List programs for station |
| POST | `/stations/:id/programs` | `station:write` | Create program |
| GET | `/programs/:id` | `station:read` | Get program |
| PUT | `/programs/:id` | `station:write` | Update program |
| DELETE | `/programs/:id` | `station:write` | Delete program |
| GET | `/programs/:id/clocks` | `station:read` | List show clocks |
| POST | `/programs/:id/clocks` | `station:write` | Create show clock |
| PUT | `/programs/:id/clocks/:clockId` | `station:write` | Update show clock |
| DELETE | `/programs/:id/clocks/:clockId` | `station:write` | Delete show clock |
| GET | `/programs/:id/episodes` | `station:read` | List episodes (filter by `?month=YYYY-MM`) |

### Program Episodes
**Gateway owner**: Station service (`station :3002`).

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/program-episodes/:episodeId` | `station:read` | Get episode detail |
| PUT | `/program-episodes/:episodeId` | `station:write` | Update episode |

---

## Library Service (`/api/v1`)

### Categories
| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/stations/:id/categories` | `library:read` | List categories |
| POST | `/stations/:id/categories` | `library:write` | Create category |
| PUT | `/categories/:id` | `library:write` | Update category |
| DELETE | `/categories/:id` | `library:write` | Delete category (soft delete if songs exist) |

### Songs
| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/stations/:id/songs` | `library:read` | List songs (paginated, filterable) |
| POST | `/stations/:id/songs` | `library:write` | Create song |
| GET | `/songs/:id` | `library:read` | Get song + eligible slots |
| PUT | `/songs/:id` | `library:write` | Update song |
| DELETE | `/songs/:id` | `library:write` | Deactivate song |
| POST | `/stations/:id/songs/import` | `library:write` | Bulk import songs (XLSX or CSV) |

### GET `/stations/:id/songs` query params
| Param | Type | Description |
|---|---|---|
| `category_id` | uuid | Filter by category |
| `search` | string | Search title or artist |
| `is_active` | boolean | Filter active/inactive |
| `page` | int | Page number (default: 1) |
| `limit` | int | Page size (default: 50, max: 200) |

### POST `/stations/:id/songs/import`
```json
// Request: multipart/form-data
// Fields: file (XLSX or CSV), format ("xlsm_playgen" | "csv_generic")

// Response 202
{
  "job_id": "uuid",
  "status": "queued",
  "estimated_rows": 210
}
```

---

## Scheduler Service (`/api/v1`)

### Templates
| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/stations/:id/templates` | `template:read` | List templates |
| POST | `/stations/:id/templates` | `template:write` | Create template |
| GET | `/templates/:id` | `template:read` | Get template + slots |
| PUT | `/templates/:id` | `template:write` | Update template metadata |
| DELETE | `/templates/:id` | `template:write` | Delete template |
| POST | `/templates/:id/clone` | `template:write` | Clone to same or another station |
| GET | `/templates/:id/slots` | `template:read` | Get all slot definitions |
| PUT | `/templates/:id/slots` | `template:write` | Replace all slots (bulk update) |

### Playlist Generation
| Method | Path | Permission | Description |
|---|---|---|---|
| POST | `/stations/:id/playlists/generate` | `playlist:write` | Manually trigger generation |
| GET | `/jobs/:job_id/status` | `playlist:read` | Poll generation job status |

### Cron Schedule
| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/stations/:id/cron` | `rules:read` | Get cron schedule config |
| PUT | `/stations/:id/cron` | `rules:write` | Update cron schedule |
| POST | `/stations/:id/cron/enable` | `rules:write` | Enable auto-generation |
| POST | `/stations/:id/cron/disable` | `rules:write` | Disable auto-generation |

### Rotation Rules
| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/stations/:id/rotation-rules` | `rules:read` | Get rotation rules |
| PUT | `/stations/:id/rotation-rules` | `rules:write` | Update rotation rules |

### POST `/stations/:id/playlists/generate`
```json
// Request
{
  "date": "2026-04-03",
  "template_id": "uuid",
  "override_rules": {}    // optional partial rule overrides for this run only
}

// Response 202
{
  "job_id": "uuid",
  "status": "queued",
  "playlist_id": "uuid"
}
```

### GET `/jobs/:job_id/status`
```json
// Response 200
{
  "job_id": "uuid",
  "status": "processing",   // queued | processing | completed | failed
  "progress": 42,           // slots filled out of total
  "total_slots": 96,
  "playlist_id": "uuid",
  "error": null
}
```

---

## Playlist Service (`/api/v1`)

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/stations/:id/playlists` | `playlist:read` | List playlists (paginated) |
| GET | `/playlists/:id` | `playlist:read` | Get playlist + all entries |
| DELETE | `/playlists/:id` | `playlist:write` | Delete playlist (draft/failed only) |
| POST | `/playlists/:id/approve` | `playlist:approve` | Approve playlist |
| POST | `/playlists/:id/regenerate` | `playlist:write` | Re-run generation (preserves overrides) |
| PUT | `/playlist-entries/:id` | `playlist:write` | Override a single slot (manual swap) |
| POST | `/playlists/:id/regenerate-slot` | `playlist:write` | Re-generate one slot only |
| POST | `/playlists/:id/export` | `playlist:export` | Export playlist file |

### GET `/stations/:id/playlists` query params
| Param | Type | Description |
|---|---|---|
| `date_from` | date | Start date filter |
| `date_to` | date | End date filter |
| `status` | string | Filter by status |
| `page` | int | Page number |

### GET `/playlists/:id` response
```json
{
  "id": "uuid",
  "station_id": "uuid",
  "date": "2026-04-03",
  "status": "ready",
  "generated_at": "2026-04-02T23:01:15Z",
  "entries": [
    {
      "hour": 4,
      "position": 1,
      "song": {
        "id": "uuid",
        "title": "A Man Without Love",
        "artist": "Engelbert Humperdinck",
        "category_code": "FGsA"
      },
      "is_manual_override": false
    }
  ]
}
```

### PUT `/playlist-entries/:id` (manual override)
```json
// Request
{ "song_id": "uuid" }

// Response 200
{
  "id": "uuid",
  "hour": 4,
  "position": 1,
  "song_id": "uuid",
  "is_manual_override": true,
  "overridden_by": "user-uuid",
  "overridden_at": "2026-04-02T14:30:00Z"
}
```

### POST `/playlists/:id/export`
```json
// Request
{ "format": "xlsx" }   // xlsx | csv

// Response 200
// Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
// Content-Disposition: attachment; filename="iFM-Manila-2026-04-03.xlsx"
// Body: binary file
```

---

## Analytics Service (`/api/v1`)

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/stations/:id/rotation-report` | `analytics:read` | Play counts per song in date range |
| GET | `/stations/:id/overplayed-songs` | `analytics:read` | Songs exceeding rotation thresholds |
| GET | `/stations/:id/underplayed-songs` | `analytics:read` | Songs rarely/never scheduled |
| GET | `/stations/:id/category-distribution` | `analytics:read` | % of playlist per category |
| GET | `/songs/:id/history` | `analytics:read` | Per-song play timeline |

### GET `/stations/:id/rotation-report` query params
| Param | Type | Description |
|---|---|---|
| `date_from` | date | Required |
| `date_to` | date | Required |
| `category_id` | uuid | Optional filter |

---

## Health Checks (no auth)

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Returns `{ status: "ok", service: "auth-service" }` per service |

---

## Pagination Convention

All list endpoints follow:
```json
{
  "data": [...],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 210,
    "total_pages": 5
  }
}
```
