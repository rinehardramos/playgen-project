-- Daypart assignments: which DJ profile runs at which time block per station
CREATE TYPE dj_daypart AS ENUM ('morning', 'midday', 'afternoon', 'evening', 'overnight');

CREATE TABLE dj_daypart_assignments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id     UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    dj_profile_id  UUID NOT NULL REFERENCES dj_profiles(id) ON DELETE RESTRICT,
    daypart        dj_daypart NOT NULL,
    -- hour range (inclusive, 0-23)
    start_hour     SMALLINT NOT NULL,
    end_hour       SMALLINT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_daypart_hours CHECK (start_hour >= 0 AND end_hour <= 23 AND start_hour < end_hour)
);

CREATE INDEX idx_dj_daypart_station ON dj_daypart_assignments(station_id);
-- One daypart per station (no overlap enforced at app level)
CREATE UNIQUE INDEX idx_dj_daypart_unique ON dj_daypart_assignments(station_id, daypart);
