CREATE TABLE dj_profiles (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id     UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    name           VARCHAR(255) NOT NULL,
    persona_prompt TEXT NOT NULL,
    tone           VARCHAR(100) NOT NULL,
    energy_level   VARCHAR(100) NOT NULL,
    catchphrases   TEXT[] NOT NULL DEFAULT '{}',
    voice_config   JSONB NOT NULL DEFAULT '{}',
    is_default     BOOLEAN NOT NULL DEFAULT FALSE,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dj_profiles_station ON dj_profiles(station_id);
CREATE UNIQUE INDEX idx_dj_profiles_station_default ON dj_profiles(station_id) WHERE is_default = TRUE;
