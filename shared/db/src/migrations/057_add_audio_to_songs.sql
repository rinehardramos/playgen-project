ALTER TABLE songs ADD COLUMN audio_url TEXT;
ALTER TABLE songs ADD COLUMN audio_source VARCHAR(50);
COMMENT ON COLUMN songs.audio_url IS 'URL or local path to the audio file';
COMMENT ON COLUMN songs.audio_source IS 'Provenance: upload, youtube, royalty_free';
