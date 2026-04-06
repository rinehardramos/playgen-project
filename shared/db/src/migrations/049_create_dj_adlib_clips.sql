-- Migration 049: Pre-recorded adlib clip library
-- Stores audio clips uploaded by stations for use as adlib segments in DJ shows.
CREATE TABLE dj_adlib_clips (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id          UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    name                VARCHAR(255) NOT NULL,
    audio_url           TEXT NOT NULL,
    tags                TEXT[] NOT NULL DEFAULT '{}',
    audio_duration_sec  NUMERIC(8,2),
    file_size_bytes     INTEGER,
    original_filename   TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dj_adlib_clips_station ON dj_adlib_clips(station_id);
