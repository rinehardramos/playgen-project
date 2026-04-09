-- Migration 053: support standalone (non-playlist-bound) DJ segments
ALTER TABLE dj_segments ALTER COLUMN script_id DROP NOT NULL;
ALTER TABLE dj_segments ADD COLUMN IF NOT EXISTS standalone BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS dj_segments_station_type_created_idx
  ON dj_segments (segment_type, created_at DESC);
