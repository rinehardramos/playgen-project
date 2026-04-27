-- Add stream_url to stations for persisting HLS playlist URL from publish pipeline
ALTER TABLE stations
  ADD COLUMN IF NOT EXISTS stream_url VARCHAR(1000);

COMMENT ON COLUMN stations.stream_url IS 'HLS playlist URL (R2 public URL) set by the publish pipeline; used by public API to return the stream endpoint';
