-- Add per-segment review status for granular script review flow (issue #31)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dj_segment_review_status') THEN
    CREATE TYPE dj_segment_review_status AS ENUM ('pending', 'approved', 'edited', 'rejected');
  END IF;
END $$;

ALTER TABLE dj_segments
  ADD COLUMN IF NOT EXISTS segment_review_status dj_segment_review_status NOT NULL DEFAULT 'pending';
