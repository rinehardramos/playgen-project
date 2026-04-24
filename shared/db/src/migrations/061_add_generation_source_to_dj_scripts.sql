-- Add generation_source to dj_scripts so externally-generated scripts
-- (e.g. written by Claude Code and submitted via POST /dj/scripts/submit-external)
-- are distinguishable from scripts produced by the internal LLM worker.
ALTER TABLE dj_scripts
  ADD COLUMN IF NOT EXISTS generation_source TEXT NOT NULL DEFAULT 'internal';

COMMENT ON COLUMN dj_scripts.generation_source IS
  'Origin of the script: ''internal'' (BullMQ LLM worker) | ''external'' (Claude Code / out-of-band)';
