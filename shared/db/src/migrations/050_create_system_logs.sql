-- Migration 050: Create system_logs table for audit trail
-- Stores notifications, errors, and config changes across all services

CREATE TABLE system_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level       VARCHAR(10) NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  category    VARCHAR(20) NOT NULL CHECK (category IN ('dj', 'tts', 'review', 'config', 'playlist', 'auth', 'system')),
  company_id  UUID        REFERENCES companies(id) ON DELETE CASCADE,
  station_id  UUID        REFERENCES stations(id) ON DELETE SET NULL,
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  message     TEXT        NOT NULL,
  metadata    JSONB
);

COMMENT ON COLUMN system_logs.metadata IS 'Arbitrary key/value bag for structured context: e.g. { "script_id": "...", "error": "...", "duration_ms": 123 }. Shape varies per category.';

-- Primary query index: company logs newest-first
CREATE INDEX idx_system_logs_company_created ON system_logs(company_id, created_at DESC);

-- Filter support
CREATE INDEX idx_system_logs_level    ON system_logs(level);
CREATE INDEX idx_system_logs_category ON system_logs(category);

-- Retention function: purge logs older than 90 days (call periodically or via a cron endpoint)
CREATE OR REPLACE FUNCTION purge_old_system_logs() RETURNS void AS $$
  DELETE FROM system_logs WHERE created_at < NOW() - INTERVAL '90 days';
$$ LANGUAGE sql;
