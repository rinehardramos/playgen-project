CREATE TABLE play_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    song_id    UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    played_at  TIMESTAMPTZ NOT NULL,
    source     VARCHAR(20) NOT NULL DEFAULT 'generated'
               CHECK (source IN ('generated','manual','imported'))
);
CREATE INDEX idx_play_history_song_station ON play_history(song_id, station_id);
CREATE INDEX idx_play_history_played_at ON play_history(played_at DESC);
CREATE INDEX idx_play_history_station_date ON play_history(station_id, played_at);
