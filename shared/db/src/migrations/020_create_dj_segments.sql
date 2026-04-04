CREATE TABLE dj_segments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dj_script_id      UUID NOT NULL REFERENCES dj_scripts(id) ON DELETE CASCADE,
    dj_profile_id     UUID NOT NULL REFERENCES dj_profiles(id) ON DELETE CASCADE,
    segment_type      VARCHAR(50) NOT NULL
                      CHECK (segment_type IN ('segue','song_intro','song_outro','show_open','show_close','time_check','station_id')),
    script_text       TEXT,
    audio_file_path   VARCHAR(255),
    audio_duration_ms INTEGER,
    before_song_id    UUID, -- Can refer to playlist_entries(id)
    after_song_id     UUID,  -- Can refer to playlist_entries(id)
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dj_segments_script ON dj_segments(dj_script_id);
CREATE INDEX idx_dj_segments_profile ON dj_segments(dj_profile_id);
