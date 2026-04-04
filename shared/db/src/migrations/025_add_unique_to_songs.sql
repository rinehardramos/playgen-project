-- Enforce uniqueness for songs within a station to prevent duplicates on import
CREATE UNIQUE INDEX idx_songs_unique_identity ON songs (station_id, title, artist);
