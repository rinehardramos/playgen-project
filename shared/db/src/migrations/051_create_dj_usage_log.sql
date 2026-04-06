-- Track LLM token usage and TTS character usage per DJ script/segment generation.
-- Used for cost visibility, billing estimates, and soft rate limiting.

CREATE TABLE dj_usage_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  station_id       UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  script_id        UUID REFERENCES dj_scripts(id) ON DELETE SET NULL,
  segment_id       UUID REFERENCES dj_segments(id) ON DELETE SET NULL,

  -- 'llm' or 'tts'
  usage_type       VARCHAR(10) NOT NULL CHECK (usage_type IN ('llm', 'tts')),

  provider         VARCHAR(50),
  model            VARCHAR(100),

  -- LLM-only fields
  prompt_tokens    INT,
  completion_tokens INT,
  total_tokens     INT,

  -- TTS-only fields
  character_count  INT,

  -- Cost estimate in USD (null if model not in pricing table)
  cost_usd         NUMERIC(10, 6),

  -- Arbitrary metadata (segment_type, voice_id, etc.)
  metadata         JSONB
);

-- Index for the monthly usage query (GET /stations/:id/dj/usage?month=YYYY-MM)
-- date_trunc on TIMESTAMPTZ is STABLE not IMMUTABLE, so use a plain btree.
CREATE INDEX idx_dj_usage_log_station_created
  ON dj_usage_log(station_id, created_at);

COMMENT ON COLUMN dj_usage_log.metadata IS 'Arbitrary key-value context stored as JSONB — e.g. segment_type for LLM rows, voice_id for TTS rows.';
