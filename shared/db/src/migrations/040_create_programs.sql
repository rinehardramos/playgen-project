-- Migration 033: Create programs table
-- Programs are recurring named shows (e.g. "Morning Rush", "Afternoon Drive")
-- that own a schedule, a Show Clock format, and a collection of Episodes.

CREATE TABLE programs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id      UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    -- Schedule: which days and what hours this program airs
    active_days     TEXT[] NOT NULL DEFAULT '{}',
    start_hour      SMALLINT NOT NULL DEFAULT 0 CHECK (start_hour BETWEEN 0 AND 23),
    end_hour        SMALLINT NOT NULL DEFAULT 24 CHECK (end_hour BETWEEN 1 AND 24),
    -- Optional link to a music rotation template for this program's songs
    template_id     UUID REFERENCES templates(id) ON DELETE SET NULL,
    -- UI display
    color_tag       VARCHAR(20),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    -- Auto-created catch-all program for pre-existing playlists (one per station)
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(station_id, name)
);

CREATE INDEX idx_programs_station ON programs(station_id);
CREATE INDEX idx_programs_station_active ON programs(station_id, is_active);
