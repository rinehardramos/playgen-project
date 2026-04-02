CREATE TABLE songs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    station_id   UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    category_id  UUID NOT NULL REFERENCES categories(id),
    title        VARCHAR(500) NOT NULL,
    artist       VARCHAR(500) NOT NULL,
    duration_sec INT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    raw_material TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_songs_station ON songs(station_id);
CREATE INDEX idx_songs_category ON songs(category_id);
CREATE INDEX idx_songs_artist ON songs(artist);
CREATE INDEX idx_songs_company ON songs(company_id);
