CREATE TABLE rotation_rules (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID NOT NULL UNIQUE REFERENCES stations(id) ON DELETE CASCADE,
    rules      JSONB NOT NULL DEFAULT '{"max_plays_per_day":1,"min_gap_hours":3,"max_same_artist_per_hour":1,"artist_separation_slots":4,"category_weights":{}}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id)
);
