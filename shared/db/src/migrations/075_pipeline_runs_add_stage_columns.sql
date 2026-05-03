-- Migration 073: Add per-stage JSONB columns + triggered_by to pipeline_runs
--
-- Migration 068 used CREATE TABLE IF NOT EXISTS which was a no-op (067 already created
-- the table with a different schema). This migration adds the missing per-stage columns
-- so the frontend Pipeline UI can read granular stage status without reconstructing it
-- from the generic stages_completed map.

ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS stage_playlist  JSONB NOT NULL DEFAULT '{"status":"pending"}'::jsonb,
  ADD COLUMN IF NOT EXISTS stage_dj_script JSONB NOT NULL DEFAULT '{"status":"pending"}'::jsonb,
  ADD COLUMN IF NOT EXISTS stage_review    JSONB NOT NULL DEFAULT '{"status":"pending"}'::jsonb,
  ADD COLUMN IF NOT EXISTS stage_tts       JSONB NOT NULL DEFAULT '{"status":"pending"}'::jsonb,
  ADD COLUMN IF NOT EXISTS stage_publish   JSONB NOT NULL DEFAULT '{"status":"pending"}'::jsonb,
  ADD COLUMN IF NOT EXISTS triggered_by    VARCHAR(20) NOT NULL DEFAULT 'manual'
                                           CHECK (triggered_by IN ('manual','cron','auto'));

COMMENT ON COLUMN pipeline_runs.stage_playlist  IS 'Playlist generation stage: {status, started_at, completed_at, error, metadata}';
COMMENT ON COLUMN pipeline_runs.stage_dj_script IS 'DJ script generation stage: {status, progress, step, started_at, completed_at, error, metadata}';
COMMENT ON COLUMN pipeline_runs.stage_review    IS 'Manual script review stage: {status, started_at, completed_at, error}';
COMMENT ON COLUMN pipeline_runs.stage_tts       IS 'TTS audio generation stage: {status, progress, started_at, completed_at, error, metadata}';
COMMENT ON COLUMN pipeline_runs.stage_publish   IS 'Publish to CDN stage: {status, started_at, completed_at, error, metadata}';
COMMENT ON COLUMN pipeline_runs.triggered_by    IS 'Who triggered this run: manual (user), cron (scheduler), auto (downstream event)';
