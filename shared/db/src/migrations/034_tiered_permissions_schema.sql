-- Enable ltree extension
CREATE EXTENSION IF NOT EXISTS ltree;

-- Alter companies table
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS account_type VARCHAR(20) NOT NULL DEFAULT 'individual'
    CHECK (account_type IN ('individual', 'corporate')),
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_stripe_customer
  ON companies(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- Alter roles table
ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS max_assignable_scope VARCHAR(20) DEFAULT NULL
    CHECK (max_assignable_scope IS NULL
      OR max_assignable_scope IN ('company', 'market', 'cluster', 'station', 'subchannel'));

-- Mark existing system roles
UPDATE roles SET is_system = TRUE WHERE code IN ('super_admin', 'company_admin');

-- Alter users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS default_station_id UUID REFERENCES stations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS perm_version INT NOT NULL DEFAULT 1;

-- Alter stations table for hierarchy
ALTER TABLE stations
  ADD COLUMN IF NOT EXISTS parent_station_id UUID REFERENCES stations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS station_type VARCHAR(20) NOT NULL DEFAULT 'station'
    CHECK (station_type IN ('group', 'market', 'cluster', 'station', 'subchannel')),
  ADD COLUMN IF NOT EXISTS path LTREE,
  ADD COLUMN IF NOT EXISTS depth SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inherit_library BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

-- Initialize path for existing stations (flat, no parent)
UPDATE stations SET path = text2ltree(replace(id::text, '-', '_')) WHERE path IS NULL;

CREATE INDEX IF NOT EXISTS idx_stations_parent ON stations(parent_station_id);
CREATE INDEX IF NOT EXISTS idx_stations_path_gist ON stations USING GIST (path);
CREATE INDEX IF NOT EXISTS idx_stations_path_btree ON stations USING BTREE (path);
