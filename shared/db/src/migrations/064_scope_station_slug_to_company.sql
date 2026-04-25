-- Re-scope stations.slug uniqueness from global to per-company.
-- The old index made station slugs globally unique across all tenants;
-- this caused `ingest-external` to link multiple companies' scripts to
-- the same production station row when different tenants shared a slug.
-- The new index enforces uniqueness only within a company (company_id, slug).
DROP INDEX IF EXISTS stations_slug_unique;
CREATE UNIQUE INDEX IF NOT EXISTS stations_company_slug_unique
  ON stations (company_id, slug)
  WHERE slug IS NOT NULL;
