CREATE TABLE playlists (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id   UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    template_id  UUID REFERENCES templates(id),
    date         DATE NOT NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','generating','ready','approved','exported','failed')),
    generated_at TIMESTAMPTZ,
    generated_by UUID REFERENCES users(id),
    approved_at  TIMESTAMPTZ,
    approved_by  UUID REFERENCES users(id),
    notes        TEXT,
    UNIQUE(station_id, date)
);
CREATE INDEX idx_playlists_station_date ON playlists(station_id, date);
