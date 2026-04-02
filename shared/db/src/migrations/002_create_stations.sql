CREATE TABLE stations (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id           UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name                 VARCHAR(255) NOT NULL,
    timezone             VARCHAR(100) NOT NULL DEFAULT 'Asia/Manila',
    broadcast_start_hour SMALLINT NOT NULL DEFAULT 4,
    broadcast_end_hour   SMALLINT NOT NULL DEFAULT 3,
    active_days          VARCHAR(3)[] NOT NULL DEFAULT ARRAY['MON','TUE','WED','THU','FRI','SAT','SUN'],
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_stations_company ON stations(company_id);
