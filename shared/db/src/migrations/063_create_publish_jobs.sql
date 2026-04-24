-- Migration 063: publish_jobs table
--
-- Tracks the state of each "Publish to Production" pipeline run.
-- One row per publish attempt per script. Stage state is persisted before
-- advancing so crash recovery can resume from the last completed stage.

CREATE TABLE publish_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id         UUID NOT NULL REFERENCES dj_scripts(id) ON DELETE CASCADE,
  station_id        UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,

  -- Overall pipeline status
  status            TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'running', 'completed', 'failed')),

  -- Current stage being executed (null = not yet started)
  current_stage     TEXT CHECK (current_stage IN (
                      'validate', 'upload_assets', 'ingest_production', 'trigger_playout'
                    )),

  -- JSON map of stage → result, e.g. {"validate": "ok", "upload_assets": "ok"}
  -- COMMENT: Stage results persisted incrementally so retries resume correctly
  stages_completed  JSONB NOT NULL DEFAULT '{}',

  -- Last error message if status = 'failed'
  error_message     TEXT,

  -- BullMQ job ID for correlation
  bull_job_id       TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active job per station (enforced at application level via this index)
CREATE UNIQUE INDEX publish_jobs_station_active
  ON publish_jobs (station_id)
  WHERE status IN ('queued', 'running');

-- Fast lookup by script
CREATE INDEX publish_jobs_script_id ON publish_jobs (script_id);

-- Keep updated_at current
CREATE TRIGGER publish_jobs_updated_at
  BEFORE UPDATE ON publish_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
