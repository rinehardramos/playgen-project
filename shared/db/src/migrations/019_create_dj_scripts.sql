-- Generated DJ scripts, one per playlist
CREATE TYPE dj_review_status AS ENUM ('pending_review', 'approved', 'rejected', 'auto_approved');

CREATE TABLE dj_scripts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id     UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    station_id      UUID NOT NULL REFERENCES stations(id),
    dj_profile_id   UUID NOT NULL REFERENCES dj_profiles(id),
    review_status   dj_review_status NOT NULL DEFAULT 'pending_review',
    -- Review tracking
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    review_notes    TEXT,                          -- editor notes or reject reason
    -- Generation meta
    llm_model       VARCHAR(150) NOT NULL,
    generation_ms   INT,                           -- how long LLM took
    total_segments  SMALLINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dj_scripts_playlist ON dj_scripts(playlist_id);
CREATE INDEX idx_dj_scripts_station  ON dj_scripts(station_id);
CREATE INDEX idx_dj_scripts_review   ON dj_scripts(review_status);
