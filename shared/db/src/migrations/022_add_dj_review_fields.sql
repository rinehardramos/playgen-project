ALTER TABLE dj_scripts
  ADD COLUMN review_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN review_notes TEXT,
  ADD COLUMN reviewed_by UUID REFERENCES users(id),
  ADD COLUMN reviewed_at TIMESTAMPTZ;

ALTER TABLE dj_segments
  ADD COLUMN review_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected', 'edited'));

-- Update DJJobStatus check constraint to include pending_review
-- Note: In standard SQL you can't easily alter a CHECK constraint without dropping and re-adding.
-- For this project, we might just use VARCHAR(30) without strict DB check if it's too complex,
-- but let's try to be precise if we can. 
-- Actually, the previous migration for dj_scripts already has some statuses.
-- Let's re-define it if needed, but since it's a new migration, we can just allow 'pending_review' in the application layer.
-- Actually, let's update the constraint for dj_scripts.status.
ALTER TABLE dj_scripts DROP CONSTRAINT dj_scripts_status_check;
ALTER TABLE dj_scripts ADD CONSTRAINT dj_scripts_status_check 
  CHECK (status IN ('queued', 'generating_scripts', 'pending_review', 'generating_audio', 'completed', 'failed'));
