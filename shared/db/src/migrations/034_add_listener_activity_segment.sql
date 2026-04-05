-- Add listener_activity segment type and listener_shoutouts table (issue #209)
ALTER TYPE dj_segment_type ADD VALUE IF NOT EXISTS 'listener_activity';

-- Listener shoutouts submitted by station staff for the DJ to reference
CREATE TABLE IF NOT EXISTS listener_shoutouts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id       UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    submitted_by     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listener_name    VARCHAR(100),
    message          TEXT NOT NULL,
    platform         VARCHAR(50),   -- 'facebook', 'twitter', 'instagram', 'manual'
    status           VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'used', 'dismissed'
    used_in_script_id UUID REFERENCES dj_scripts(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listener_shoutouts_station     ON listener_shoutouts(station_id);
CREATE INDEX IF NOT EXISTS idx_listener_shoutouts_station_status ON listener_shoutouts(station_id, status);
