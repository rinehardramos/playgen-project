-- Pipeline Runs: end-to-end tracking for the Radio Program Factory pipeline
-- Each row represents one full pipeline execution with per-stage JSONB tracking

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id      UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  playlist_id     UUID REFERENCES playlists(id) ON DELETE SET NULL,
  script_id       UUID REFERENCES dj_scripts(id) ON DELETE SET NULL,
  date            DATE NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','completed','failed','cancelled')),
  triggered_by    VARCHAR(20) NOT NULL DEFAULT 'manual'
                  CHECK (triggered_by IN ('manual','cron','auto')),

  -- Per-stage tracking: {status, started_at, completed_at, error, progress, step, metadata}
  stage_playlist  JSONB NOT NULL DEFAULT '{"status":"pending"}'::jsonb,
  stage_dj_script JSONB NOT NULL DEFAULT '{"status":"pending"}'::jsonb,
  stage_review    JSONB NOT NULL DEFAULT '{"status":"pending"}'::jsonb,
  stage_tts       JSONB NOT NULL DEFAULT '{"status":"pending"}'::jsonb,
  stage_publish   JSONB NOT NULL DEFAULT '{"status":"pending"}'::jsonb,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pipeline_runs_station ON pipeline_runs (station_id);
CREATE INDEX idx_pipeline_runs_status ON pipeline_runs (status);
CREATE INDEX idx_pipeline_runs_date ON pipeline_runs (station_id, date DESC);

COMMENT ON TABLE pipeline_runs IS 'End-to-end Radio Program Factory pipeline tracking — one row per run with per-stage JSONB';
COMMENT ON COLUMN pipeline_runs.stage_playlist IS 'Playlist generation stage: {status, started_at, completed_at, error, metadata}';
COMMENT ON COLUMN pipeline_runs.stage_dj_script IS 'DJ script generation stage with progress: {status, progress, step, ...}';
COMMENT ON COLUMN pipeline_runs.stage_review IS 'Script review/approval stage: {status, ...}';
COMMENT ON COLUMN pipeline_runs.stage_tts IS 'TTS audio generation stage: {status, progress, ...}';
COMMENT ON COLUMN pipeline_runs.stage_publish IS 'Publish to production stage with sub-stages: {status, ...}';
