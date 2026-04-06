-- Ensure one manifest per script version (idempotent: safe to re-run)
DO $$
BEGIN
  ALTER TABLE dj_show_manifests ADD CONSTRAINT dj_show_manifests_script_id_key UNIQUE (script_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;   -- constraint already exists
  WHEN undefined_column THEN NULL;   -- column was renamed; skip silently
END $$;
