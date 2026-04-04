-- Show manifests: final assembly of audio segments for a DJ show
CREATE TYPE manifest_status AS ENUM ('building', 'ready', 'failed');

CREATE TABLE dj_show_manifests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    script_id       UUID NOT NULL REFERENCES dj_scripts(id) ON DELETE CASCADE,
    station_id      UUID NOT NULL REFERENCES stations(id),
    status          manifest_status NOT NULL DEFAULT 'building',
    -- Storage
    storage_provider VARCHAR(50) NOT NULL DEFAULT 'local',  -- 'local' | 's3'
    manifest_url    TEXT,                          -- JSON playlist manifest
    total_duration_sec NUMERIC(8,2),
    error_message   TEXT,
    built_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dj_show_manifests_script  ON dj_show_manifests(script_id);
CREATE INDEX idx_dj_show_manifests_station ON dj_show_manifests(station_id);
