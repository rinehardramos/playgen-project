CREATE TABLE playlist_entries (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id        UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    hour               SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
    position           SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 4),
    song_id            UUID NOT NULL REFERENCES songs(id),
    is_manual_override BOOLEAN NOT NULL DEFAULT FALSE,
    overridden_by      UUID REFERENCES users(id),
    overridden_at      TIMESTAMPTZ,
    UNIQUE(playlist_id, hour, position)
);
CREATE INDEX idx_playlist_entries_playlist ON playlist_entries(playlist_id);
CREATE INDEX idx_playlist_entries_song ON playlist_entries(song_id);
