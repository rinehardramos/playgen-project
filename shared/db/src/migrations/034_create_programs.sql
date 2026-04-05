-- Create programs table (issue #210: Program as higher-tier entity)
-- A Program is a recurring named radio show (e.g. "Morning Rush", "Afternoon Drive")
-- that defines the format and schedule for a recurring set of episodes.

CREATE TABLE IF NOT EXISTS programs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id      UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    description     TEXT,
    -- Recurring schedule
    air_days        TEXT[] NOT NULL DEFAULT '{}',  -- e.g. ARRAY['mon','tue','wed','thu','fri']
    start_time      TIME,                           -- local time for the station
    end_time        TIME,
    -- DJ association
    dj_profile_id   UUID REFERENCES dj_profiles(id) ON DELETE SET NULL,
    -- Format config: ordered list of content block rules (JSONB for flexibility)
    format_config   JSONB,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_programs_station ON programs(station_id);
CREATE INDEX IF NOT EXISTS idx_programs_station_active ON programs(station_id, is_active);
