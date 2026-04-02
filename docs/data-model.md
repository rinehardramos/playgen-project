# PlayGen — Database Schema Reference

All tables live in a single PostgreSQL 16 database. Multi-tenancy is enforced at the application layer via `company_id` / `station_id` scoping on every query. Row-level security (RLS) is enabled as a defense-in-depth backstop.

---

## Tables

### `companies`
```sql
CREATE TABLE companies (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    slug        VARCHAR(100) NOT NULL UNIQUE,   -- URL-safe identifier
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### `stations`
```sql
CREATE TABLE stations (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id           UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name                 VARCHAR(255) NOT NULL,
    timezone             VARCHAR(100) NOT NULL DEFAULT 'Asia/Manila',
    broadcast_start_hour SMALLINT NOT NULL DEFAULT 4,   -- 0–23
    broadcast_end_hour   SMALLINT NOT NULL DEFAULT 3,   -- 0–23 (3 = 3AM next day)
    active_days          VARCHAR(3)[] NOT NULL DEFAULT ARRAY['MON','TUE','WED','THU','FRI','SAT','SUN'],
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_stations_company ON stations(company_id);
```

---

### `roles`
Configurable per company. Role `code` is fixed internally; `label` is display-only.

```sql
CREATE TABLE roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,  -- NULL = platform role (super_admin)
    code        VARCHAR(50) NOT NULL,   -- super_admin | company_admin | station_admin | scheduler | viewer
    label       VARCHAR(100) NOT NULL,  -- e.g. "Music Director" (displayed in UI)
    permissions TEXT[] NOT NULL DEFAULT '{}',
    UNIQUE(company_id, code)
);
```

**Built-in permission strings** (checked in service middleware):
- `company:read`, `company:write`
- `station:read`, `station:write`
- `library:read`, `library:write`
- `template:read`, `template:write`
- `playlist:read`, `playlist:write`, `playlist:approve`, `playlist:export`
- `analytics:read`
- `users:read`, `users:write`
- `rules:read`, `rules:write`

---

### `users`
```sql
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    role_id       UUID NOT NULL REFERENCES roles(id),
    email         VARCHAR(255) NOT NULL UNIQUE,
    display_name  VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    station_ids   UUID[] NOT NULL DEFAULT '{}',  -- stations this user has access to
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_company ON users(company_id);
CREATE INDEX idx_users_email ON users(email);
```

---

### `refresh_tokens`
```sql
CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
```

---

### `categories`
Music categories per station (e.g., FGs = Foreign Golden Standards slow).

```sql
CREATE TABLE categories (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id       UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    code             VARCHAR(20) NOT NULL,    -- e.g. FGsA, A7, JBxA
    label            VARCHAR(255) NOT NULL,   -- e.g. "Foreign Golden Standards - Slow"
    rotation_weight  NUMERIC(4,2) NOT NULL DEFAULT 1.0,
    color_tag        VARCHAR(7),              -- hex color for UI display
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(station_id, code)
);
CREATE INDEX idx_categories_station ON categories(station_id);
```

---

### `songs`
Songs belong to a company (shared pool), but are linked to a station's category.

```sql
CREATE TABLE songs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    station_id   UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    category_id  UUID NOT NULL REFERENCES categories(id),
    title        VARCHAR(500) NOT NULL,
    artist       VARCHAR(500) NOT NULL,
    duration_sec INT,                        -- nullable until duration data is available
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    raw_material TEXT,                       -- original encoded string from .xlsm for audit
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_songs_station ON songs(station_id);
CREATE INDEX idx_songs_category ON songs(category_id);
CREATE INDEX idx_songs_artist ON songs(artist);
```

---

### `song_slots`
Which hours a song is eligible to be scheduled. Maps from `{FGsA_4-FGsA_5-}` encoding.

```sql
CREATE TABLE song_slots (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    song_id       UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    eligible_hour SMALLINT NOT NULL CHECK (eligible_hour BETWEEN 0 AND 23)
);
CREATE INDEX idx_song_slots_song ON song_slots(song_id);
CREATE UNIQUE INDEX idx_song_slots_unique ON song_slots(song_id, eligible_hour);
```

---

### `song_station_locks` *(Future — P3)*
See `TODO.md`. Lock a song to specific stations within a company.

```sql
-- Future table — not created in MVP migrations
-- CREATE TABLE song_station_locks (
--     song_id    UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
--     station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
--     PRIMARY KEY (song_id, station_id)
-- );
```

---

### `rotation_rules`
One row per station. Rules stored as JSONB for schema-free extensibility.

```sql
CREATE TABLE rotation_rules (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID NOT NULL UNIQUE REFERENCES stations(id) ON DELETE CASCADE,
    rules      JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id)
);
```

**`rules` JSONB schema** (TypeScript interface — enforced at application layer):
```typescript
interface RotationRules {
  max_plays_per_day: number;           // default: 1
  min_gap_hours: number;               // default: 3
  max_same_artist_per_hour: number;    // default: 1
  artist_separation_slots: number;     // default: 4
  category_weights: Record<string, number>;  // e.g. { "FGs": 1.0, "7": 0.8 }
  // Future rule types added here without DB migration
}
```

---

### `templates`
Scheduling templates per station.

```sql
CREATE TABLE templates (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id            UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    name                  VARCHAR(255) NOT NULL,
    type                  VARCHAR(20) NOT NULL CHECK (type IN ('1_day', '3_hour', '4_hour')),
    is_default            BOOLEAN NOT NULL DEFAULT FALSE,
    day_of_week_overrides JSONB NOT NULL DEFAULT '{}',
    -- MVP: empty JSONB (one template for all days)
    -- Full: { "MON": true, "TUE": true, "SAT": false }
    -- Or map to different template IDs per day:
    -- { "SAT": "uuid-of-weekend-template", "SUN": "uuid-of-weekend-template" }
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_templates_station ON templates(station_id);
```

---

### `template_slots`
The individual slot definitions within a template.

```sql
CREATE TABLE template_slots (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id          UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    hour                 SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
    position             SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 4),
    required_category_id UUID NOT NULL REFERENCES categories(id),
    UNIQUE(template_id, hour, position)
);
CREATE INDEX idx_template_slots_template ON template_slots(template_id);
```

---

### `playlists`
One playlist per station per date.

```sql
CREATE TABLE playlists (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id    UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    template_id   UUID REFERENCES templates(id),
    date          DATE NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'generating', 'ready', 'approved', 'exported', 'failed')),
    generated_at  TIMESTAMPTZ,
    generated_by  UUID REFERENCES users(id),   -- NULL if cron-generated
    approved_at   TIMESTAMPTZ,
    approved_by   UUID REFERENCES users(id),
    notes         TEXT,
    UNIQUE(station_id, date)
);
CREATE INDEX idx_playlists_station_date ON playlists(station_id, date);
```

---

### `playlist_entries`
Individual song assignments within a playlist.

```sql
CREATE TABLE playlist_entries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id         UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    hour                SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
    position            SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 4),
    song_id             UUID NOT NULL REFERENCES songs(id),
    is_manual_override  BOOLEAN NOT NULL DEFAULT FALSE,
    overridden_by       UUID REFERENCES users(id),
    overridden_at       TIMESTAMPTZ,
    UNIQUE(playlist_id, hour, position)
);
CREATE INDEX idx_playlist_entries_playlist ON playlist_entries(playlist_id);
CREATE INDEX idx_playlist_entries_song ON playlist_entries(song_id);
```

---

### `play_history`
One row per song play event. Replaces the LOAD sheet matrix.

```sql
CREATE TABLE play_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    song_id    UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    played_at  TIMESTAMPTZ NOT NULL,
    source     VARCHAR(20) NOT NULL DEFAULT 'generated'
               CHECK (source IN ('generated', 'manual', 'imported'))
               -- 'imported' = seeded from LOAD sheet
);
CREATE INDEX idx_play_history_song_station ON play_history(song_id, station_id);
CREATE INDEX idx_play_history_played_at ON play_history(played_at DESC);
CREATE INDEX idx_play_history_station_date ON play_history(station_id, played_at);
```

---

### `generation_jobs`
Tracks async playlist generation jobs (BullMQ job mirror for API status queries).

```sql
CREATE TABLE generation_jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id    UUID NOT NULL REFERENCES stations(id),
    playlist_id   UUID REFERENCES playlists(id),
    status        VARCHAR(20) NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    error_message TEXT,
    queued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    triggered_by  VARCHAR(20) NOT NULL DEFAULT 'manual'
                  CHECK (triggered_by IN ('manual', 'cron'))
);
CREATE INDEX idx_generation_jobs_station ON generation_jobs(station_id);
```

---

## Indexes Summary

Key query patterns and their supporting indexes:

| Query | Index |
|---|---|
| All songs for a station | `idx_songs_station` |
| Eligible songs for an hour + category | `idx_songs_category` + `idx_song_slots_song` |
| Recent plays of a song at a station | `idx_play_history_song_station` |
| Plays within date range for rotation check | `idx_play_history_station_date` |
| Playlist for a station on a date | `idx_playlists_station_date` |
| Playlist entries for a playlist | `idx_playlist_entries_playlist` |

---

## Migration File Convention

```
shared/db/migrations/
  001_create_companies.sql
  002_create_stations.sql
  003_create_roles.sql
  004_create_users.sql
  005_create_refresh_tokens.sql
  006_create_categories.sql
  007_create_songs.sql
  008_create_song_slots.sql
  009_create_rotation_rules.sql
  010_create_templates.sql
  011_create_template_slots.sql
  012_create_playlists.sql
  013_create_playlist_entries.sql
  014_create_play_history.sql
  015_create_generation_jobs.sql
```
