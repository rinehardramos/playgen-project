-- Script segment types used across templates and generated segments
CREATE TYPE dj_segment_type AS ENUM (
    'show_intro',
    'song_intro',
    'song_transition',
    'show_outro',
    'station_id',
    'time_check',
    'weather_tease',
    'ad_break'
);

-- Script templates: prompt skeletons per segment type, customisable per station
CREATE TABLE dj_script_templates (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id     UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    segment_type   dj_segment_type NOT NULL,
    name           VARCHAR(100) NOT NULL,
    prompt_template TEXT NOT NULL,         -- Handlebars-style {{variables}} injected at generation time
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dj_script_templates_station ON dj_script_templates(station_id);
