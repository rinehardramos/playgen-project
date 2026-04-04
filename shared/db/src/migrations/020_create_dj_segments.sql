-- Individual script segments within a generated DJ script
CREATE TABLE dj_segments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    script_id        UUID NOT NULL REFERENCES dj_scripts(id) ON DELETE CASCADE,
    playlist_entry_id UUID REFERENCES playlist_entries(id),  -- null for non-song segments
    segment_type     dj_segment_type NOT NULL,
    position         SMALLINT NOT NULL,            -- ordering within the script
    -- Generated content
    script_text      TEXT NOT NULL,                -- raw LLM output
    edited_text      TEXT,                         -- human-edited override (used for TTS if set)
    -- TTS output (populated after approval)
    audio_url        TEXT,
    audio_duration_sec NUMERIC(6,2),
    tts_provider     VARCHAR(50),
    tts_voice_id     VARCHAR(100),
    tts_generated_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dj_segments_script   ON dj_segments(script_id);
CREATE INDEX idx_dj_segments_position ON dj_segments(script_id, position);
