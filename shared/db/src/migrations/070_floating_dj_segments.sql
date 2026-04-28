-- Migration 070: floating DJ segments for dynamic layered audio
--
-- Adds two nullable columns to dj_segments:
--   start_offset_sec        — seconds into the anchored song at which this segment starts playing.
--                             NULL = sequential (existing behaviour, plays between songs).
--   anchor_playlist_entry_id — the playlist_entries row (song) this segment floats over.
--                             NULL = not anchored to a specific song.
--
-- A floating segment (start_offset_sec IS NOT NULL) is delivered on the DJ HLS
-- track at the correct program-timeline offset rather than in the sequential gap
-- between songs. The music track continues underneath with volume ducking applied
-- by the player.

ALTER TABLE dj_segments
  ADD COLUMN IF NOT EXISTS start_offset_sec       FLOAT       NULL,
  ADD COLUMN IF NOT EXISTS anchor_playlist_entry_id UUID       NULL
    REFERENCES playlist_entries(id) ON DELETE SET NULL;

COMMENT ON COLUMN dj_segments.start_offset_sec IS
  'Seconds from the start of the anchored song at which this DJ segment begins. NULL = sequential gap segment.';

COMMENT ON COLUMN dj_segments.anchor_playlist_entry_id IS
  'The playlist_entries row (song) this segment floats over. NULL for sequential segments.';

-- Index for fetching all floating segments for a given song
CREATE INDEX IF NOT EXISTS idx_dj_segments_anchor
  ON dj_segments (anchor_playlist_entry_id)
  WHERE anchor_playlist_entry_id IS NOT NULL;
