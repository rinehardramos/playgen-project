-- Migration 034: Create show_format_clocks and show_clock_slots tables
-- A Show Clock is the industry-standard 60-minute format wheel that defines
-- what content (songs, DJ talk, weather, jokes, etc.) appears in what order
-- within each hour of a Program. Multiple clocks per program are supported
-- (e.g. a different format for the opening hour vs. mid-show hours).

CREATE TABLE show_format_clocks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id       UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    name             VARCHAR(255) NOT NULL DEFAULT 'Standard Hour',
    -- Which hours of the program this clock applies to (NULL = all hours)
    applies_to_hours SMALLINT[],
    is_default       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_show_format_clocks_program ON show_format_clocks(program_id);

-- Content types that can appear as clock slots
CREATE TYPE clock_content_type AS ENUM (
    'song',
    'dj_segment',
    'weather',
    'news',
    'adlib',
    'joke',
    'time_check',
    'station_id',
    'ad_break',
    'listener_activity'
);

-- Individual slots within a Show Clock (the ordered sequence of content items)
CREATE TABLE show_clock_slots (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clock_id         UUID NOT NULL REFERENCES show_format_clocks(id) ON DELETE CASCADE,
    -- Ordering within the clock (1-based)
    position         SMALLINT NOT NULL,
    content_type     clock_content_type NOT NULL,
    -- For song slots: optional category constraint (NULL = any category)
    category_id      UUID REFERENCES categories(id) ON DELETE SET NULL,
    -- For dj_segment slots: the segment type hint (maps to DjSegmentType values)
    segment_type     VARCHAR(50),
    -- Guidance timing within the 60-minute clock (minutes from top of hour)
    -- This is informational for producers, not a hard constraint
    target_minute    SMALLINT CHECK (target_minute BETWEEN 0 AND 59),
    duration_est_sec SMALLINT,
    is_required      BOOLEAN NOT NULL DEFAULT TRUE,
    notes            TEXT,
    UNIQUE(clock_id, position)
);

CREATE INDEX idx_show_clock_slots_clock ON show_clock_slots(clock_id);
