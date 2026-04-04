-- Add per-segment review_status to dj_segments for granular review flow
CREATE TYPE dj_segment_review_status AS ENUM ('pending', 'approved', 'edited', 'rejected');

ALTER TABLE dj_segments
  ADD COLUMN segment_review_status dj_segment_review_status NOT NULL DEFAULT 'pending';
