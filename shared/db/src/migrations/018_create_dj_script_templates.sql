CREATE TABLE dj_script_templates (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id     UUID REFERENCES stations(id) ON DELETE CASCADE,
    segment_type   VARCHAR(50) NOT NULL
                   CHECK (segment_type IN ('segue','song_intro','song_outro','show_open','show_close','time_check','station_id')),
    prompt_template TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(station_id, segment_type)
);

CREATE INDEX idx_dj_templates_station ON dj_script_templates(station_id);
