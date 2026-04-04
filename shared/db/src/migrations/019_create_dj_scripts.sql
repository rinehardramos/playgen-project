CREATE TABLE dj_scripts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id    UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    playlist_id   UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    status        VARCHAR(30) NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','generating_scripts','generating_audio','completed','failed')),
    error_message TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at  TIMESTAMPTZ
);

CREATE INDEX idx_dj_scripts_station ON dj_scripts(station_id);
CREATE INDEX idx_dj_scripts_playlist ON dj_scripts(playlist_id);
CREATE INDEX idx_dj_scripts_status ON dj_scripts(status);
