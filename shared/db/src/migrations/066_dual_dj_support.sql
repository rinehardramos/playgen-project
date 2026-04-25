-- Dual-DJ support: per-segment speaker tag + secondary DJ profile on scripts.
-- Enables two DJs to interact in dialogue within a single script.

ALTER TABLE dj_segments ADD COLUMN IF NOT EXISTS speaker VARCHAR(20) DEFAULT NULL;
COMMENT ON COLUMN dj_segments.speaker IS 'Speaker tag for dual-DJ scripts: dj1, dj2, or NULL for single-DJ';

ALTER TABLE dj_scripts ADD COLUMN IF NOT EXISTS secondary_dj_profile_id UUID DEFAULT NULL
    REFERENCES dj_profiles(id);
COMMENT ON COLUMN dj_scripts.secondary_dj_profile_id IS 'Optional second DJ profile for dual-DJ shows';

ALTER TABLE dj_scripts ADD COLUMN IF NOT EXISTS voice_map JSONB DEFAULT NULL;
COMMENT ON COLUMN dj_scripts.voice_map IS 'Maps speaker tags to TTS voice IDs, e.g. {"Marco":"en_paul_excited","Mia":"gb_jane_sarcasm"}';
