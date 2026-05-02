-- Migration 073: HLS dual-track manifest storage on dj_scripts
--
-- The dynamic layered audio feature (#532) generates two synchronised HLS streams
-- during the publish pipeline:
--
--   music.m3u8  — packed-audio playlist of song files (ADTS AAC, HLS "packed audio" format)
--   dj.m3u8     — silence base + DJ speech clips at exact program-timeline offsets
--
-- Both URLs are stored here so the ingest payload can forward them to production
-- and the OwnRadio player can load both tracks simultaneously.
--
-- Only populated for scripts that have at least one floating segment; sequential-only
-- scripts leave hls_tracks NULL (old behaviour unchanged).

ALTER TABLE dj_scripts
  ADD COLUMN IF NOT EXISTS hls_tracks JSONB NULL;

COMMENT ON COLUMN dj_scripts.hls_tracks IS
  'Dual HLS track URLs: {"music": "https://cdn.../music.m3u8", "dj": "https://cdn.../dj.m3u8"}. '
  'NULL for sequential-only scripts that have not been through the layered-audio publish pipeline.';
