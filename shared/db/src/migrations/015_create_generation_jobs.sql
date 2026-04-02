CREATE TABLE generation_jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id    UUID NOT NULL REFERENCES stations(id),
    playlist_id   UUID REFERENCES playlists(id),
    status        VARCHAR(20) NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','processing','completed','failed')),
    error_message TEXT,
    queued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    triggered_by  VARCHAR(20) NOT NULL DEFAULT 'manual'
                  CHECK (triggered_by IN ('manual','cron'))
);
CREATE INDEX idx_generation_jobs_station ON generation_jobs(station_id);
CREATE INDEX idx_generation_jobs_status ON generation_jobs(status);
