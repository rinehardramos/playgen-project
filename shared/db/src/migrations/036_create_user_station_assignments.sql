-- User-station assignment join table (replaces users.station_ids UUID[])
CREATE TABLE IF NOT EXISTS user_station_assignments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id       UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  role_override_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  assigned_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, station_id)
);

CREATE INDEX IF NOT EXISTS idx_user_station_user ON user_station_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_station_station ON user_station_assignments(station_id);

-- Migrate existing station_ids array to join table
INSERT INTO user_station_assignments (user_id, station_id)
SELECT u.id, s.id
FROM users u
CROSS JOIN LATERAL unnest(u.station_ids) AS sid
JOIN stations s ON s.id = sid
ON CONFLICT DO NOTHING;

-- Add station_assignments JSONB column to user_invites for richer invite data
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS station_assignments JSONB;
