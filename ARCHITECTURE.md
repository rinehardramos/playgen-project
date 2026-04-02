# PlayGen — System Architecture

## 1. High-Level System Diagram

```mermaid
graph TB
    subgraph Clients
        WEB[Next.js Frontend]
        API_CLIENT[External API Client]
    end

    subgraph Gateway
        GW[Nginx API Gateway<br/>Rate Limiting / Routing]
    end

    subgraph Services
        AUTH[auth-service<br/>:3001]
        STATION[station-service<br/>:3002]
        LIBRARY[library-service<br/>:3003]
        SCHEDULER[scheduler-service<br/>:3004]
        PLAYLIST[playlist-service<br/>:3005]
        ANALYTICS[analytics-service<br/>:3006]
    end

    subgraph Infrastructure
        PG[(PostgreSQL 16)]
        REDIS[(Redis 7<br/>Queue + Cache)]
        QUEUE[BullMQ Workers<br/>Playlist Generation]
    end

    WEB --> GW
    API_CLIENT --> GW
    GW --> AUTH
    GW --> STATION
    GW --> LIBRARY
    GW --> SCHEDULER
    GW --> PLAYLIST
    GW --> ANALYTICS

    AUTH --> PG
    STATION --> PG
    LIBRARY --> PG
    SCHEDULER --> PG
    SCHEDULER --> REDIS
    SCHEDULER --> QUEUE
    PLAYLIST --> PG
    ANALYTICS --> PG
    QUEUE --> PG
```

---

## 2. Multi-Tenancy Model

```mermaid
erDiagram
    COMPANY ||--o{ STATION : owns
    COMPANY ||--o{ USER : has
    STATION ||--o{ USER : assigned_to
    STATION ||--o{ SONG : has
    STATION ||--o{ CATEGORY : has
    STATION ||--o{ TEMPLATE : has
    STATION ||--|| ROTATION_RULES : configured_by
    STATION ||--o{ PLAYLIST : generates
    COMPANY ||--o{ ROLE : defines

    COMPANY {
        uuid id
        string name
        string slug
        timestamp created_at
    }

    STATION {
        uuid id
        uuid company_id
        string name
        string timezone
        int broadcast_start_hour
        int broadcast_end_hour
        string[] active_days
        timestamp created_at
    }

    USER {
        uuid id
        uuid company_id
        uuid[] station_ids
        uuid role_id
        string email
        string display_name
        string password_hash
    }

    ROLE {
        uuid id
        uuid company_id
        string code
        string label
        string[] permissions
    }
```

---

## 3. Core Data Model (Entity Relationships)

```mermaid
erDiagram
    CATEGORY ||--o{ SONG : contains
    SONG ||--o{ SONG_SLOT : has_eligible
    SONG ||--o{ PLAY_HISTORY : tracked_in
    SONG ||--o{ PLAYLIST_ENTRY : scheduled_in

    TEMPLATE ||--o{ TEMPLATE_SLOT : composed_of
    CATEGORY ||--o{ TEMPLATE_SLOT : required_by

    PLAYLIST ||--o{ PLAYLIST_ENTRY : contains
    STATION ||--o{ PLAYLIST : has
    STATION ||--|| ROTATION_RULES : governs
    TEMPLATE ||--o{ PLAYLIST : used_in

    CATEGORY {
        uuid id
        uuid station_id
        string code
        string label
        float rotation_weight
        string color_tag
    }

    SONG {
        uuid id
        uuid station_id
        string title
        string artist
        uuid category_id
        int duration_sec
        bool is_active
    }

    SONG_SLOT {
        uuid id
        uuid song_id
        int eligible_hour
    }

    TEMPLATE {
        uuid id
        uuid station_id
        string name
        enum type
        jsonb day_of_week_overrides
    }

    TEMPLATE_SLOT {
        uuid id
        uuid template_id
        int hour
        int position
        uuid required_category_id
    }

    PLAYLIST {
        uuid id
        uuid station_id
        uuid template_id
        date date
        enum status
        timestamp generated_at
        uuid generated_by
    }

    PLAYLIST_ENTRY {
        uuid id
        uuid playlist_id
        int hour
        int position
        uuid song_id
        bool is_manual_override
        uuid overridden_by
    }

    PLAY_HISTORY {
        uuid id
        uuid song_id
        uuid station_id
        timestamp played_at
    }

    ROTATION_RULES {
        uuid id
        uuid station_id
        jsonb rules
    }
```

---

## 4. Playlist Generation Flow

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend
    participant GW as Gateway
    participant SCH as scheduler-service
    participant QUEUE as BullMQ
    participant WORKER as Generation Worker
    participant DB as PostgreSQL
    participant PLY as playlist-service

    User->>FE: Click "Generate Playlist" (date, template)
    FE->>GW: POST /api/v1/stations/:id/playlists/generate
    GW->>SCH: Forward request
    SCH->>DB: Validate station, template, date
    SCH->>QUEUE: Enqueue generation job {station_id, template_id, date}
    SCH-->>FE: 202 Accepted {job_id}

    FE->>GW: GET /api/v1/jobs/:job_id/status (polling / SSE)

    WORKER->>DB: Load template slots
    loop For each slot (ordered by hour, position)
        WORKER->>DB: Get required category for slot
        WORKER->>DB: Get eligible songs (category + eligible_hours)
        WORKER->>DB: Get recent play_history (apply rotation_rules)
        WORKER->>WORKER: Filter candidates, sort by least-recently-played
        WORKER->>DB: Assign song to playlist_entry
        WORKER->>DB: Write play_history record
    end
    WORKER->>DB: Mark playlist status = 'ready'
    WORKER-->>FE: Job complete (via SSE or polling response)

    FE->>GW: GET /api/v1/playlists/:id
    GW->>PLY: Forward
    PLY->>DB: Fetch playlist + entries
    PLY-->>FE: Full playlist JSON
```

---

## 5. Cron-Based Auto Generation

```mermaid
flowchart TD
    CRON[Cron Job<br/>e.g. daily at 11PM] --> CHECK{Station has<br/>active template?}
    CHECK -- No --> SKIP[Skip, log warning]
    CHECK -- Yes --> GEN[Enqueue generation job<br/>for next broadcast day]
    GEN --> QUEUE[BullMQ Queue]
    QUEUE --> WORKER[Generation Worker]
    WORKER --> SUCCESS{Generated OK?}
    SUCCESS -- Yes --> NOTIFY[Notify station_admin<br/>via email/webhook]
    SUCCESS -- No --> RETRY[Retry up to 3x]
    RETRY --> FAIL_NOTIFY[Alert station_admin<br/>of failure]
```

---

## 6. Authentication & Authorization Flow

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend
    participant GW as Gateway
    participant AUTH as auth-service
    participant SVC as Any Service

    User->>FE: Login (email, password)
    FE->>GW: POST /api/v1/auth/login
    GW->>AUTH: Forward
    AUTH->>AUTH: Verify password hash
    AUTH-->>FE: { access_token (15min), refresh_token (7d) }

    FE->>GW: GET /api/v1/... + Bearer access_token
    GW->>GW: Verify JWT signature + expiry
    GW->>SVC: Forward with decoded claims {user_id, company_id, station_ids, permissions}
    SVC->>SVC: Check permission for this route
    SVC-->>FE: Response

    Note over FE,AUTH: When access_token expires
    FE->>GW: POST /api/v1/auth/refresh + refresh_token
    GW->>AUTH: Forward
    AUTH->>AUTH: Rotate refresh token (invalidate old)
    AUTH-->>FE: New access_token + refresh_token
```

---

## 7. Export / Integration Architecture

```mermaid
flowchart LR
    PLY[playlist-service] --> ADAPTER{Export Adapter<br/>Router}
    ADAPTER --> XLSX[XLSX Adapter<br/>iFM Manila format]
    ADAPTER --> CSV[CSV Adapter<br/>Generic]
    ADAPTER --> RCS[RCS GSelector Adapter<br/>future]
    ADAPTER --> NP[NaturalPlay Adapter<br/>future]
    ADAPTER --> ZETTA[Zetta Adapter<br/>future]

    XLSX --> FILE[File Download]
    CSV --> FILE
    RCS --> FILE
    NP --> FILE
    ZETTA --> FILE
```

Each adapter is a standalone module implementing a single `export(playlist): Buffer` interface. Adding a new broadcast system requires only a new adapter file — no changes to core services.

---

## 8. Deployment Topology (Target)

```mermaid
graph TB
    subgraph Docker Compose / Kubernetes
        GW[Nginx Gateway<br/>port 80/443]
        FE[Frontend :3000]
        AUTH[auth-service :3001]
        STATION[station-service :3002]
        LIBRARY[library-service :3003]
        SCHEDULER[scheduler-service :3004]
        PLAYLIST[playlist-service :3005]
        ANALYTICS[analytics-service :3006]
        WORKER[BullMQ Worker]
        REDIS[(Redis)]
        PG[(PostgreSQL)]
    end

    INTERNET --> GW
    GW --> FE
    GW --> AUTH
    GW --> STATION
    GW --> LIBRARY
    GW --> SCHEDULER
    GW --> PLAYLIST
    GW --> ANALYTICS
    SCHEDULER --> REDIS
    WORKER --> REDIS
    WORKER --> PG
    AUTH --> PG
    STATION --> PG
    LIBRARY --> PG
    SCHEDULER --> PG
    PLAYLIST --> PG
    ANALYTICS --> PG
```

---

## Design Decisions & Rationale

| Decision | Rationale |
|---|---|
| Stateless JWT auth | Services can scale horizontally without shared session state |
| BullMQ for generation | Playlist generation is CPU-bound; offloading prevents gateway timeouts |
| JSONB for rotation_rules | Rules vary per station; JSONB avoids schema migrations when rules change |
| JSONB for template day_of_week_overrides | MVP uses one template; JSONB future-proofs per-day-of-week templates without a new table |
| Per-company role definitions | Radio companies use different job titles; roles map internally to fixed permission sets |
| Company-level song sharing | Songs can be shared across stations within a company; future station-locking via `song_station_locks` table |
| Adapter pattern for exports | Broadcast system formats (RCS, Zetta, NaturalPlay) are proprietary; isolating them prevents coupling to core |
| Playlist immutability with override flag | Auto-generated entries can be re-run without losing manual changes (`is_manual_override = true` entries are preserved) |
