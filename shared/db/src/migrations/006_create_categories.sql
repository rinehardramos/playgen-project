CREATE TABLE categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id      UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    code            VARCHAR(20) NOT NULL,
    label           VARCHAR(255) NOT NULL,
    rotation_weight NUMERIC(4,2) NOT NULL DEFAULT 1.0,
    color_tag       VARCHAR(7),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(station_id, code)
);
CREATE INDEX idx_categories_station ON categories(station_id);
