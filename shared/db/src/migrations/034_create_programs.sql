-- Create programs table (issue #210: Program as higher-tier entity)
-- A Program is a recurring named radio show (e.g. "Morning Rush", "Afternoon Drive")

CREATE TABLE IF NOT EXISTS programs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id      UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    description     TEXT,
    air_days        TEXT[] NOT NULL DEFAULT '{}',
    start_time      TIME,
    end_time        TIME,
    dj_profile_id   UUID REFERENCES dj_profiles(id) ON DELETE SET NULL,
    format_config   JSONB,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_programs_station        ON programs(station_id);
CREATE INDEX IF NOT EXISTS idx_programs_station_active ON programs(station_id, is_active);
