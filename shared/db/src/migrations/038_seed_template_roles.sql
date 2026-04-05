-- Mark existing company_admin and station_admin as system roles
UPDATE roles SET is_system = TRUE
WHERE code IN ('super_admin', 'company_admin', 'station_admin', 'scheduler', 'viewer')
  AND company_id IS NULL;

-- Insert industry template roles (platform-level, is_template = TRUE)
-- These serve as clonable templates for company admins

-- General Manager — full access except billing/company write
WITH r AS (
  INSERT INTO roles (code, label, is_system, is_template, description)
  VALUES ('general_manager', 'General Manager', FALSE, TRUE, 'Full station operations — library, templates, playlists, DJ, analytics, settings')
  ON CONFLICT (company_id, code) WHERE company_id IS NULL DO NOTHING
  RETURNING id
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r
CROSS JOIN permissions p
WHERE p.code IN (
  'station:read','station:write',
  'library:read','library:write','library:delete',
  'template:read','template:write',
  'playlist:read','playlist:write','playlist:approve','playlist:export',
  'analytics:read','analytics:export',
  'users:read','users:write','users:invite',
  'roles:read',
  'rules:read','rules:write',
  'dj:read','dj:write','dj:approve','dj:config',
  'settings:read','settings:write'
)
ON CONFLICT DO NOTHING;

-- Program Director
WITH r AS (
  INSERT INTO roles (code, label, is_system, is_template, description)
  VALUES ('program_director', 'Program Director', FALSE, TRUE, 'Programming focus — library, templates, playlists, rules, DJ, analytics')
  ON CONFLICT (company_id, code) WHERE company_id IS NULL DO NOTHING
  RETURNING id
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r
CROSS JOIN permissions p
WHERE p.code IN (
  'library:read','library:write','library:delete',
  'template:read','template:write',
  'playlist:read','playlist:write','playlist:approve','playlist:export',
  'analytics:read',
  'rules:read','rules:write',
  'dj:read','dj:write','dj:approve'
)
ON CONFLICT DO NOTHING;

-- Music Director
WITH r AS (
  INSERT INTO roles (code, label, is_system, is_template, description)
  VALUES ('music_director', 'Music Director', FALSE, TRUE, 'Music-focused — library management, playlist review, DJ read')
  ON CONFLICT (company_id, code) WHERE company_id IS NULL DO NOTHING
  RETURNING id
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r
CROSS JOIN permissions p
WHERE p.code IN (
  'library:read','library:write',
  'template:read',
  'playlist:read',
  'rules:read',
  'dj:read'
)
ON CONFLICT DO NOTHING;

-- Traffic Manager
WITH r AS (
  INSERT INTO roles (code, label, is_system, is_template, description)
  VALUES ('traffic_manager', 'Traffic Manager', FALSE, TRUE, 'Scheduling and playlist management')
  ON CONFLICT (company_id, code) WHERE company_id IS NULL DO NOTHING
  RETURNING id
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r
CROSS JOIN permissions p
WHERE p.code IN (
  'library:read',
  'template:read',
  'playlist:read','playlist:write','playlist:approve','playlist:export',
  'analytics:read',
  'rules:read'
)
ON CONFLICT DO NOTHING;

-- On-Air Talent
WITH r AS (
  INSERT INTO roles (code, label, is_system, is_template, description)
  VALUES ('on_air_talent', 'On-Air Talent', FALSE, TRUE, 'DJ operations — generate and view scripts, view library')
  ON CONFLICT (company_id, code) WHERE company_id IS NULL DO NOTHING
  RETURNING id
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r
CROSS JOIN permissions p
WHERE p.code IN (
  'library:read',
  'playlist:read',
  'dj:read','dj:write'
)
ON CONFLICT DO NOTHING;

-- Viewer / Intern
WITH r AS (
  INSERT INTO roles (code, label, is_system, is_template, description)
  VALUES ('viewer_template', 'Viewer / Intern', FALSE, TRUE, 'Read-only access to library, playlists, analytics, templates')
  ON CONFLICT (company_id, code) WHERE company_id IS NULL DO NOTHING
  RETURNING id
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r
CROSS JOIN permissions p
WHERE p.code IN (
  'library:read',
  'template:read',
  'playlist:read',
  'analytics:read'
)
ON CONFLICT DO NOTHING;
