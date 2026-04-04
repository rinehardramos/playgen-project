CREATE TABLE dj_daypart_assignments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id     UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    dj_profile_id  UUID NOT NULL REFERENCES dj_profiles(id) ON DELETE CASCADE,
    start_hour     SMALLINT NOT NULL,
    end_hour       SMALLINT NOT NULL,
    days_of_week   VARCHAR(3)[] NOT NULL DEFAULT ARRAY['MON','TUE','WED','THU','FRI','SAT','SUN'],
    priority       INTEGER NOT NULL DEFAULT 1,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dj_dayparts_station ON dj_daypart_assignments(station_id);
CREATE INDEX idx_dj_dayparts_profile ON dj_daypart_assignments(dj_profile_id);
