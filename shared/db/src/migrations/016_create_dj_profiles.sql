-- DJ Profiles: per-company, reusable persona definitions
CREATE TABLE dj_profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,          -- e.g. "Alex"
    personality     TEXT NOT NULL,                  -- freeform personality prompt injection
    voice_style     VARCHAR(100) NOT NULL DEFAULT 'energetic',
    -- LLM config (OpenRouter)
    llm_model       VARCHAR(150) NOT NULL DEFAULT 'anthropic/claude-sonnet-4-5',
    llm_temperature NUMERIC(3,2) NOT NULL DEFAULT 0.8,
    -- TTS config
    tts_provider    VARCHAR(50)  NOT NULL DEFAULT 'openai',
    tts_voice_id    VARCHAR(100) NOT NULL DEFAULT 'alloy',
    -- Meta
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dj_profiles_company ON dj_profiles(company_id);
-- Only one default profile per company
CREATE UNIQUE INDEX idx_dj_profiles_default ON dj_profiles(company_id) WHERE is_default = TRUE;
