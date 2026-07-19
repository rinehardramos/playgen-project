-- playlist_entries.song_id blocked the station-delete cascade (stations →
-- songs) once a playlist had been generated. API-level song deletion is soft
-- (is_active = false), so a hard song delete only happens when its station is
-- being removed — at which point the playlists go too. Cascade.
ALTER TABLE playlist_entries
  DROP CONSTRAINT playlist_entries_song_id_fkey;

ALTER TABLE playlist_entries
  ADD CONSTRAINT playlist_entries_song_id_fkey
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE;
