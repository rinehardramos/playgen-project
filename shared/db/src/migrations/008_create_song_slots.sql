CREATE TABLE song_slots (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    song_id       UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    eligible_hour SMALLINT NOT NULL CHECK (eligible_hour BETWEEN 0 AND 23)
);
CREATE INDEX idx_song_slots_song ON song_slots(song_id);
CREATE UNIQUE INDEX idx_song_slots_unique ON song_slots(song_id, eligible_hour);
