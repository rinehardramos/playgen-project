CREATE TABLE templates (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id            UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    name                  VARCHAR(255) NOT NULL,
    type                  VARCHAR(20) NOT NULL CHECK (type IN ('1_day', '3_hour', '4_hour')),
    is_default            BOOLEAN NOT NULL DEFAULT FALSE,
    day_of_week_overrides JSONB NOT NULL DEFAULT '{}',
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_templates_station ON templates(station_id);
