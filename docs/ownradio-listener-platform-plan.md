# PlayGen — OwnRadio Listener Platform: Implementation Plan

**Date:** 2026-04-20
**Scope:** Everything PlayGen needs to build so OwnRadio works end-to-end.
**Guiding principle:** OwnRadio is a consumer of PlayGen. All work lives in PlayGen.

---

## Context

PlayGen today is a **DJ/admin platform**: playlist scheduling, song library, rotation rules, AI DJ script generation. All routes require auth. OwnRadio is the **listener-facing platform**: browse stations, react, chat — and hear the same AI DJ persona that the station's music director configures.

| | PlayGen (existing) | OwnRadio (new) |
|---|---|---|
| Users | DJs, Music Directors, Admins | Listeners (public) |
| Auth | Company-scoped JWT (RBAC) | Listener JWT (email/Google) |
| Data | Song library, playlists, DJ scripts | Now-playing, reactions, chat |
| Real-time | None | Socket.io (chat, reactions, presence, DJ commentary) |
| DJ | AI persona in `dj_profiles` | **Same `dj_profiles` record** |

**There is no human/AI distinction.** The DJ shown on OwnRadio's station card is the PlayGen `dj_profiles` record — the same persona the music director configures. `dj_daypart_assignments` determines which persona is active at which hour.

---

## What OwnRadio Needs

### REST (public unless noted)
| Endpoint | Notes |
|---|---|
| `GET /public/stations` | Live stations with active DJ persona |
| `GET /public/stations/:slug` | Station detail + active DJ |
| `GET /public/stations/:slug/top-songs` | Top 10 by reaction count |
| `GET /public/stations/:slug/top-listeners` | Top 10 by activity |
| `POST /listener/auth/register` | Email registration |
| `POST /listener/auth/login` | Returns access + refresh tokens |
| `POST /listener/auth/refresh` | Rotate refresh token |
| `POST /listener/auth/logout` | Revoke refresh token |
| `GET /auth/google/listener` | Google OAuth listener flow |
| `GET /auth/google/listener/callback` | Google OAuth callback |
| `GET /listener/me` | Profile (auth required) |

### WebSocket (Socket.io)
| Direction | Event | Payload | Auth |
|---|---|---|---|
| C→S | `join_station` | `{ slug }` | No |
| C→S | `leave_station` | — | No |
| C→S | `reaction` | `{ songId, type }` | No |
| C→S | `chat_message` | `{ content }` | Yes |
| S→C | `now_playing` | `{ id, title, artist, albumCoverUrl }` | — |
| S→C | `dj_commentary` | `{ scriptText, audioUrl\|null, songId }` | — |
| S→C | `reaction_update` | `{ songId, counts }` | — |
| S→C | `new_message` | `{ displayName, content, createdAt }` | — |
| S→C | `listener_count` | `{ slug, count }` | — |
| S→C | `station_status` | `{ isLive }` | — |

---

## What NOT to Build

- DJ dashboard UI changes (existing PlayGen frontend unaffected)
- Playlist generation, rotation rules, export adapters (untouched)
- Streaming infrastructure (audio flows Icecast → browser directly)
- A separate "human DJ" entity — `dj_profiles` is the DJ, full stop

---

## Architecture: Two Additions

**1. `listener-service`** (new, port 3007) — listener auth, Socket.io, metadata poller, reactions, chat.

**2. `dj-service` extension** — one new internal-only endpoint for live on-demand commentary. All LLM/TTS machinery already exists; this adds a lightweight path that needs no playlist.

**`station-service`** gets one new unauthenticated route group (`/public/*`).

```
Nginx Gateway
  /api/v1/public/*              → station-service  (new public routes, no auth)
  /api/v1/listener/*            → listener-service (new)
  /api/v1/auth/google/listener* → listener-service
  /socket.io/*                  → listener-service (WebSocket upgrade)

Internal Docker network only (not gateway-exposed):
  listener-service → dj-service   POST /internal/dj/commentary
```

---

## Database Changes

Next migration number: **057**

### Migration 057 — Add listener-facing fields to stations

```sql
ALTER TABLE stations
  ADD COLUMN slug           VARCHAR(100) UNIQUE,
  ADD COLUMN stream_url     VARCHAR(500),
  ADD COLUMN metadata_url   VARCHAR(500),
  ADD COLUMN is_live        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN artwork_url    VARCHAR(500),
  ADD COLUMN genre          VARCHAR(50),
  ADD COLUMN dj_profile_id  UUID REFERENCES dj_profiles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_stations_slug ON stations(slug) WHERE slug IS NOT NULL;
```

> `dj_profile_id` is the default/fallback DJ for this station. At query time resolve active DJ as:
> daypart assignment for current hour → fallback to `stations.dj_profile_id` → null.
>
> **Why not dj_name/dj_bio/dj_avatar_url?** `dj_profiles` already has name, personality, voice_style.
> Duplicating them creates two sources of truth.

### Migration 058 — Create listeners

```sql
CREATE TABLE listeners (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(50)  UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  google_id     VARCHAR(255) UNIQUE,
  avatar_url    VARCHAR(500),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_listeners_email ON listeners(email);
```

### Migration 059 — Create listener_refresh_tokens

```sql
CREATE TABLE listener_refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listener_id UUID NOT NULL REFERENCES listeners(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_listener_refresh_tokens_listener ON listener_refresh_tokens(listener_id);
```

### Migration 060 — Create listener_songs

Songs detected from Icecast metadata. Separate from PlayGen `play_history` (scheduled playlist entries).

```sql
CREATE TABLE listener_songs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id      UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  title           VARCHAR(200) NOT NULL,
  artist          VARCHAR(200) NOT NULL,
  album_cover_url VARCHAR(500),
  played_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_listener_songs_station   ON listener_songs(station_id);
CREATE INDEX idx_listener_songs_played_at ON listener_songs(station_id, played_at DESC);
```

### Migration 061 — Create listener_reactions

```sql
CREATE TABLE listener_reactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id     UUID NOT NULL REFERENCES listener_songs(id) ON DELETE CASCADE,
  station_id  UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  listener_id UUID REFERENCES listeners(id) ON DELETE SET NULL,
  type        VARCHAR(20) NOT NULL CHECK (type IN ('heart','rock','party','broken_heart')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (song_id, listener_id, type)
);
CREATE INDEX idx_listener_reactions_song ON listener_reactions(station_id, song_id);
```

### Migration 062 — Create listener_chat_messages

```sql
CREATE TABLE listener_chat_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id   UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  listener_id  UUID REFERENCES listeners(id) ON DELETE SET NULL,
  display_name VARCHAR(50)  NOT NULL,
  content      VARCHAR(280) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_listener_chat_station ON listener_chat_messages(station_id, created_at DESC);
```

---

## Active DJ Resolution (shared helper)

Both the public API and the metadata poller need: "which DJ profile is on right now?"

```sql
SELECT dp.id, dp.name, dp.personality, dp.voice_style,
       dp.tts_provider, dp.tts_voice_id, dp.llm_model, dp.llm_temperature
FROM stations s
LEFT JOIN LATERAL (
  SELECT dpa.dj_profile_id
  FROM dj_daypart_assignments dpa
  WHERE dpa.station_id = s.id
    AND dpa.start_hour <= EXTRACT(HOUR FROM NOW() AT TIME ZONE s.timezone)
    AND dpa.end_hour   >  EXTRACT(HOUR FROM NOW() AT TIME ZONE s.timezone)
  LIMIT 1
) active_daypart ON TRUE
LEFT JOIN dj_profiles dp
  ON dp.id = COALESCE(active_daypart.dj_profile_id, s.dj_profile_id)
 AND dp.is_active = TRUE
WHERE s.id = $1
```

---

## Implementation Plan

---

### Task 1 — Migrations 057–062

**Files:** `shared/db/src/migrations/057_add_station_listener_fields.sql` through `062_create_listener_chat_messages.sql`

- [ ] Write all 6 migration files
- [ ] `docker compose up db -d && pnpm --filter @playgen/db migrate`
- [ ] Verify: `psql $DATABASE_URL -c "\d stations"` shows new columns
- [ ] Check `tasks/agent-collab.md` — no migration conflicts at 057–062
- [ ] Commit: `feat(db): add listener-platform migrations 057-062`

---

### Task 2 — station-service: public station API

**Files:**
- `services/station/src/routes/publicStations.ts` (new)
- `services/station/src/services/publicStationService.ts` (new)
- `services/station/src/app.ts` (register before authenticate hook)

No `authenticate` hook on any of these routes.

**GET /public/stations** — stations with slug, ordered `is_live DESC, name ASC`. Response per station:
```json
{
  "id": "uuid", "name": "Rock Haven", "slug": "rock-haven",
  "genre": "Rock", "artworkUrl": "...", "streamUrl": "...", "isLive": true,
  "listenerCount": 12,
  "dj": { "id": "uuid", "name": "Alex", "voiceStyle": "energetic" }
}
```

**GET /public/stations/:slug** — same + `dj.personality` (shown as bio) + last 5 `listener_songs`.

**GET /public/stations/:slug/top-songs**
```sql
SELECT ls.id, ls.title, ls.artist, ls.album_cover_url, ls.played_at,
       COUNT(r.id) AS reaction_count
FROM listener_songs ls
JOIN listener_reactions r ON r.song_id = ls.id
WHERE ls.station_id = $1 AND ls.played_at > NOW() - INTERVAL '24h'
GROUP BY ls.id
ORDER BY reaction_count DESC LIMIT 10
```

**GET /public/stations/:slug/top-listeners**
```sql
SELECT l.id, l.username, l.avatar_url,
       COUNT(DISTINCT r.id) + COUNT(DISTINCT m.id) AS total_score
FROM listeners l
LEFT JOIN listener_reactions r     ON r.listener_id = l.id AND r.station_id = $1
LEFT JOIN listener_chat_messages m ON m.listener_id = l.id AND m.station_id = $1
GROUP BY l.id
HAVING COUNT(DISTINCT r.id) + COUNT(DISTINCT m.id) > 0
ORDER BY total_score DESC LIMIT 10
```

- [ ] Implement service + routes
- [ ] Register in `app.ts` before the global `authenticate` hook
- [ ] Tests: 6 (list, slug lookup, unknown 404, top-songs, top-listeners, null dj when none configured)
- [ ] `pnpm --filter @playgen/station-service test` — all pass
- [ ] Commit: `feat(station): add public station API for OwnRadio`

---

### Task 3 — Scaffold listener-service

**Files:** `services/listener/package.json`, `tsconfig.json`, `src/app.ts`, `src/index.ts`, `src/db.ts`, `vitest.config.ts`

Uses `pg` directly (consistent with monorepo). `buildApp()` factory for testability; Socket.io attached in `index.ts` after `app.listen()`.

Key deps: `fastify ^5.8.4`, `@fastify/cors`, `@fastify/rate-limit`, `socket.io ^4`, `bcryptjs ^2`, `jsonwebtoken ^9`, `@playgen/middleware workspace:*`, `@playgen/types workspace:*`, `pg ^8`

Add to `docker-compose.yml`:
```yaml
listener:
  build: ./services/listener
  ports: ["3007:3007"]
  depends_on: [postgres]
  environment:
    DATABASE_URL: ${DATABASE_URL}
    JWT_LISTENER_SECRET: ${JWT_LISTENER_SECRET}
    CORS_ORIGIN: ${CORS_ORIGIN}
    DJ_SERVICE_INTERNAL_URL: ${DJ_SERVICE_INTERNAL_URL}
```

`DJ_SERVICE_INTERNAL_URL` is defined in `.env.example` and resolves to the dj-service on the Docker internal network. Never hardcoded.

- [ ] Create all scaffold files
- [ ] `pnpm --filter @playgen/listener-service typecheck` — passes
- [ ] Add service to `docker-compose.yml` using env var for internal URL
- [ ] Add `JWT_LISTENER_SECRET` and `DJ_SERVICE_INTERNAL_URL` to `.env.example`
- [ ] Commit: `feat(listener): scaffold listener-service`

---

### Task 4 — Listener auth

**Files:** `src/routes/auth.ts`, `src/services/authService.ts`, `src/lib/jwt.ts`, `src/tests/routes/auth.test.ts`

Listener JWT is separate from PlayGen company-user JWT. Different env var `JWT_LISTENER_SECRET`, different payload:
```ts
{ listenerId: string; username: string }
// access_token: 15 min  |  refresh_token: 7 days (rotated, SHA-256 hash stored)
```

Routes:
```
POST /listener/auth/register   { username, email, password } → 201 { user, access_token, refresh_token }
POST /listener/auth/login      { email, password }           → 200 { user, access_token, refresh_token }
POST /listener/auth/refresh    { refresh_token }             → 200 { access_token, refresh_token }
POST /listener/auth/logout     { refresh_token }             → 204
GET  /listener/me              Bearer required               → 200 { id, username, email, avatar_url }
```

Rules: password ≥ 8 chars, bcrypt cost 12, 409 on duplicate email/username. `password_hash` never in responses. Refresh token: SHA-256 hash stored; on use, verify → delete old → insert new.

Google OAuth placeholder returns 501, implemented in Task 8.

- [ ] Write 7 failing tests
- [ ] Run → FAIL
- [ ] Implement
- [ ] Run → PASS
- [ ] Commit: `feat(listener): add listener auth with JWT`

---

### Task 5 — dj-service: live commentary endpoint

**Files:**
- `services/dj/src/routes/commentary.ts` (new)
- `services/dj/src/services/commentaryService.ts` (new)
- `services/dj/src/app.ts` (register — internal only, not gateway-exposed)

New lightweight path through existing machinery. No BullMQ queue, no playlist, no review workflow — generate one `song_intro` synchronously.

**Endpoint:**
```
POST /internal/dj/commentary
Body:     { stationId, djProfileId, song: { title, artist } }
Response: 200 { scriptText: string, audioUrl: string | null }
          204 (no DJ configured or generation skipped)
```

**`commentaryService.ts`:**
1. Load `dj_profiles` row for `djProfileId`
2. Load station row (name, timezone, identity fields)
3. Call `llmComplete` with `buildSystemPrompt(profile)` + `buildUserPrompt({ segment_type: 'song_intro', song, station_name, ... })`
4. If `tts_provider` set and station has TTS API key: call `generateSegmentTts`, return `audioUrl`; else `audioUrl: null`
5. Do NOT write to `dj_scripts` or `dj_segments` — live commentary is ephemeral

**No auth on this route** — never exposed through Nginx. Only reachable on Docker internal network by `listener-service` via `DJ_SERVICE_INTERNAL_URL`.

- [ ] Implement `commentaryService.ts` — reuse `llmComplete`, `buildSystemPrompt`, `buildUserPrompt`, `generateSegmentTts`
- [ ] Implement `commentary.ts` route
- [ ] Register in `dj/src/app.ts`
- [ ] Unit tests: mock `llmComplete` + `generateSegmentTts`, verify correct prompt context, verify null audioUrl when no TTS key configured
- [ ] `pnpm --filter @playgen/dj-service test` — all pass
- [ ] Commit: `feat(dj): add internal live commentary endpoint for OwnRadio`

---

### Task 6 — Socket.io + metadata poller

**Files:** `services/listener/src/ws/index.ts`, `chat.ts`, `reactions.ts`, `metadata.ts`, `src/index.ts`, `src/tests/ws/chat.test.ts`

**`ws/index.ts`:**
- Verify `handshake.auth.token` against `JWT_LISTENER_SECRET`; set `socket.data.listenerId` + `socket.data.username` if valid; else anonymous
- `join_station { slug }` → join room, save slug on socket, broadcast `listener_count`
- `leave_station` → leave room (slug from socket data), broadcast updated count
- `disconnect` → broadcast updated count

**`ws/reactions.ts`:**
- Toggle: upsert/delete `listener_reactions` on `(song_id, listener_id, type)` unique constraint
- Anonymous: skip DB write, broadcast optimistically
- Debounce 500ms: emit `reaction_update { songId, counts }` per station+song

**`ws/chat.ts`:**
- Require `socket.data.listenerId` — else emit `error { code: 'AUTH_REQUIRED' }`
- Validate 1–280 chars, INSERT, broadcast `new_message`

**`ws/metadata.ts` — with DJ commentary:**

```ts
async function pollStation(io, stationId, slug, metadataUrl, timezone) {
  const metadata = await fetchIcecastMetadata(metadataUrl);
  if (!metadata) return;

  const songKey = `${metadata.artist} - ${metadata.title}`;
  if (lastSongByStation.get(stationId) === songKey) return;
  lastSongByStation.set(stationId, songKey);

  const song = await insertListenerSong(stationId, metadata);
  io.to(`station:${slug}`).emit('now_playing', song);

  // Resolve active DJ and request live commentary (fire-and-forget — never crash the poller)
  const dj = await resolveActiveDj(stationId, timezone);
  if (dj) {
    fetchLiveCommentary(stationId, dj.id, metadata)
      .then(commentary => {
        if (commentary) {
          io.to(`station:${slug}`).emit('dj_commentary', {
            scriptText: commentary.scriptText,
            audioUrl:   commentary.audioUrl,
            songId:     song.id,
          });
        }
      })
      .catch(err => console.error('dj commentary failed, skipping:', err));
  }
}
```

`fetchLiveCommentary` POSTs to `process.env.DJ_SERVICE_INTERNAL_URL + '/internal/dj/commentary'`.

`startMetadataPollers(io)`: load `WHERE is_live = true AND metadata_url IS NOT NULL`, setInterval 5s per station, setInterval 30s for discovery.

`stopAllPollers()`: clear all intervals + Maps.

**`index.ts`:**
```ts
await app.listen({ port: 3007, host: '0.0.0.0' });
const io = new Server(app.server, { cors: { origin: process.env.CORS_ORIGIN } });
setupSocketHandlers(io);
startMetadataPollers(io);
const shutdown = () => { stopAllPollers(); app.close().then(() => process.exit(0)); };
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
```

- [ ] Write chat test: real Socket.io server port 0, mock pg pool, join station, emit chat_message, verify new_message
- [ ] Run → FAIL
- [ ] Implement all ws/* + index.ts
- [ ] Run → PASS
- [ ] Commit: `feat(listener): add socket.io with chat, reactions, metadata poller, dj commentary`

---

### Task 7 — Nginx gateway routing

**File:** `gateway/nginx.conf`

Add `listener` upstream and location blocks. The `/api/v1/public/` block must come **before** any catch-all auth location.

```nginx
upstream listener {
  server listener:3007;
}

# Public station API — no auth
location /api/v1/public/ {
  proxy_pass       http://station/;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header Host $host;
}

# Listener REST
location /api/v1/listener/ {
  proxy_pass       http://listener/listener/;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header Host $host;
}

# Google OAuth for listeners
location /api/v1/auth/google/listener {
  proxy_pass       http://listener;
  proxy_set_header Host $host;
}

# Socket.io WebSocket upgrade
location /socket.io/ {
  proxy_pass           http://listener;
  proxy_http_version   1.1;
  proxy_set_header     Upgrade $http_upgrade;
  proxy_set_header     Connection "upgrade";
  proxy_set_header     Host $host;
  proxy_read_timeout   86400s;
}
```

Note: `/internal/dj/` is intentionally NOT routed through Nginx.

- [ ] Add upstream + locations
- [ ] `docker compose up --build gateway`
- [ ] `curl http://localhost/api/v1/public/stations` → JSON array
- [ ] `curl http://localhost/api/v1/listener/me` → 401
- [ ] Commit: `feat(gateway): add routing for public API, listener service, socket.io`

---

### Task 8 — Google OAuth for listeners

**Files:** `services/listener/src/routes/oauth.ts`, `src/services/oauthService.ts`

```
GET /auth/google/listener          → redirect to Google
GET /auth/google/listener/callback → upsert listener, redirect to OwnRadio with tokens
```

**Upsert logic** (Google profile: `email`, `sub`, `name`, `picture`):
1. `listeners.google_id = sub` → existing linked account, issue tokens
2. `listeners.email = email` → link `google_id` to existing account, issue tokens
3. Neither → create listener (`username` = slugified name + 4-char suffix), issue tokens

Tokens returned as query params on redirect to `OWNRADIO_REDIRECT_URL`. Frontend stores and clears URL.

Required env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_LISTENER_REDIRECT_URI`, `OWNRADIO_REDIRECT_URL` — all in `.env.example`.

- [ ] Implement `oauthService.ts` (3 scenarios, unit-tested with mocked pool)
- [ ] Implement `oauth.ts` route
- [ ] Commit: `feat(listener): add Google OAuth for listener login`

---

### Task 9 — Seed data

**File:** `shared/db/src/seeds/ownradio.ts`

4 demo stations (Rock Haven, Beat Lounge, Chill Waves, Pinoy Hits), each with `slug`, `stream_url`, `metadata_url`, `is_live: true`, `genre`, `artwork_url`, `dj_profile_id` linked to the company's default `dj_profiles` row.

1 demo listener — email/password read from `DEMO_LISTENER_EMAIL` + `DEMO_LISTENER_PASSWORD` env vars.

Add to `shared/db/package.json`: `"seed:ownradio": "tsx src/seeds/ownradio.ts"`

- [ ] Write seed
- [ ] `pnpm --filter @playgen/db seed:ownradio`
- [ ] `GET /api/v1/public/stations` → 4 stations with `dj` object
- [ ] Commit: `feat(db): add ownradio demo station seed`

---

### Task 10 — Integration smoke test

- [ ] `docker compose up --build -d`
- [ ] `pnpm --filter @playgen/db migrate && pnpm --filter @playgen/db seed:ownradio`
- [ ] `GET /api/v1/public/stations` → 4 stations, `dj.name` present
- [ ] `POST /api/v1/listener/auth/login` → `{ access_token, refresh_token, user }`
- [ ] WS: connect, emit `join_station { slug: 'rock-haven' }` → receive `listener_count`
- [ ] WS: emit `chat_message { content: 'hello' }` with valid token → receive `new_message`
- [ ] WS: verify `dj_commentary` fires within 10s of a song change (mock metadata endpoint or trigger `pollStation` directly)
- [ ] `GET /api/v1/public/stations/rock-haven/top-songs` → empty array (not error)
- [ ] Document gaps under **Post-smoke-test fixes** heading below
- [ ] Commit: `chore(listener): integration smoke test sign-off`

---

## OwnRadio Frontend Changes (after PlayGen tasks complete)

- [ ] Delete `apps/api/` from ownradio (Fastify, Prisma, seeds, tests)
- [ ] Remove `api` service from ownradio `docker-compose.yml`
- [ ] `apps/web/.env.local`: point both URLs at PlayGen gateway
- [ ] `apps/web/src/lib/api.ts`: token shape → `access_token` / `refresh_token` (15 min / 7 day rotation)
- [ ] `apps/web/src/hooks/useAuth.ts`: add refresh rotation (retry on 401)
- [ ] `apps/web/src/components/station/DJSection.tsx`: handle `dj_commentary` event — show `scriptText`; if `audioUrl` present, auto-play before song
- [ ] Remove `packages/shared/` or keep as thin re-export of PlayGen types

---

## Task Dependency Graph

```
Task 1 (migrations)        ─────────────────────────────┐
Task 2 (public API)        ── after 1                   │
Task 3 (scaffold)          ── independent               ├── Task 9 (seed) ── Task 10 (smoke)
Task 4 (listener auth)     ── after 3                   │
Task 5 (dj live endpoint)  ── independent               │
Task 6 (socket.io)         ── after 4 + 5               │
Task 7 (nginx)             ── after 3                   │
Task 8 (Google OAuth)      ── after 4                   ┘
```

Parallelizable immediately: Tasks 1, 3, 5, 7.
