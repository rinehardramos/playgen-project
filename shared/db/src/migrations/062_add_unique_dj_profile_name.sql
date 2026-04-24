-- Allow upsert by (company_id, name) in the external program ingest endpoint.
-- Previously only is_default was enforced (partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS idx_dj_profiles_company_name
  ON dj_profiles (company_id, name);
