CREATE TABLE pipeline_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id      UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','running','completed','failed','cancelled')),
  current_stage   TEXT,
  stages_completed JSONB NOT NULL DEFAULT '{}',
  config          JSONB NOT NULL DEFAULT '{}',
  error_message   TEXT,
  bull_job_id     TEXT,
  playlist_id     UUID REFERENCES playlists(id) ON DELETE SET NULL,
  script_id       UUID REFERENCES dj_scripts(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_pipeline_runs_active
  ON pipeline_runs (station_id) WHERE status IN ('queued', 'running');

CREATE INDEX idx_pipeline_runs_station ON pipeline_runs (station_id, created_at DESC);

COMMENT ON TABLE pipeline_runs IS 'End-to-end radio program generation pipeline runs (#499)';
COMMENT ON COLUMN pipeline_runs.config IS 'JSON: dj_profile_id, secondary_dj_profile_id, voice_map, auto_approve';
COMMENT ON COLUMN pipeline_runs.stages_completed IS 'JSON map of stage_name → result (e.g. {"generate_playlist": {"playlist_id": "...", "duration_ms": 1234}})';
