-- Track automatic OwnRadio pickup per podcast episode.
ALTER TABLE dj_podcast_episodes
  ADD COLUMN ownradio_status varchar(20),          -- null | published | skipped | failed
  ADD COLUMN ownradio_error text,
  ADD COLUMN ownradio_published_at timestamptz;
