-- Canonical permission registry
CREATE TABLE IF NOT EXISTS permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(50) NOT NULL UNIQUE,
  resource    VARCHAR(30) NOT NULL,
  action      VARCHAR(20) NOT NULL,
  label       VARCHAR(100) NOT NULL,
  description TEXT,
  category    VARCHAR(30) NOT NULL DEFAULT 'general',
  sort_order  INT NOT NULL DEFAULT 0,
  UNIQUE(resource, action)
);

-- Seed all 32 permissions
INSERT INTO permissions (code, resource, action, label, category, sort_order) VALUES
  ('company:read',      'company',   'read',    'View Company',           'Administration', 1),
  ('company:write',     'company',   'write',   'Edit Company',           'Administration', 2),
  ('station:read',      'station',   'read',    'View Stations',          'Station',        10),
  ('station:write',     'station',   'write',   'Edit Stations',          'Station',        11),
  ('station:create',    'station',   'create',  'Create Stations',        'Station',        12),
  ('station:delete',    'station',   'delete',  'Delete Stations',        'Station',        13),
  ('library:read',      'library',   'read',    'View Library',           'Library',        20),
  ('library:write',     'library',   'write',   'Edit Library',           'Library',        21),
  ('library:delete',    'library',   'delete',  'Delete Songs',           'Library',        22),
  ('template:read',     'template',  'read',    'View Templates',         'Programming',    30),
  ('template:write',    'template',  'write',   'Edit Templates',         'Programming',    31),
  ('playlist:read',     'playlist',  'read',    'View Playlists',         'Playlists',      40),
  ('playlist:write',    'playlist',  'write',   'Edit Playlists',         'Playlists',      41),
  ('playlist:approve',  'playlist',  'approve', 'Approve Playlists',      'Playlists',      42),
  ('playlist:export',   'playlist',  'export',  'Export Playlists',       'Playlists',      43),
  ('analytics:read',    'analytics', 'read',    'View Analytics',         'Analytics',      50),
  ('analytics:export',  'analytics', 'export',  'Export Analytics',       'Analytics',      51),
  ('users:read',        'users',     'read',    'View Users',             'Administration', 60),
  ('users:write',       'users',     'write',   'Edit Users',             'Administration', 61),
  ('users:invite',      'users',     'invite',  'Invite Users',           'Administration', 62),
  ('roles:read',        'roles',     'read',    'View Roles',             'Administration', 63),
  ('roles:write',       'roles',     'write',   'Manage Roles',           'Administration', 64),
  ('rules:read',        'rules',     'read',    'View Rotation Rules',    'Programming',    70),
  ('rules:write',       'rules',     'write',   'Edit Rotation Rules',    'Programming',    71),
  ('dj:read',           'dj',        'read',    'View DJ Scripts',        'DJ',             80),
  ('dj:write',          'dj',        'write',   'Generate DJ Scripts',    'DJ',             81),
  ('dj:approve',        'dj',        'approve', 'Approve DJ Scripts',     'DJ',             82),
  ('dj:config',         'dj',        'config',  'Configure DJ Service',   'DJ',             83),
  ('settings:read',     'settings',  'read',    'View Settings',          'Station',        90),
  ('settings:write',    'settings',  'write',   'Edit Settings',          'Station',        91),
  ('billing:read',      'billing',   'read',    'View Billing',           'Billing',        100),
  ('billing:write',     'billing',   'write',   'Manage Billing',         'Billing',        101)
ON CONFLICT (code) DO NOTHING;

-- Join table: role_permissions (replaces roles.permissions TEXT[])
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Migrate existing role permissions from TEXT[] to join table
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN LATERAL unnest(r.permissions) AS perm_code
JOIN permissions p ON p.code = perm_code
ON CONFLICT DO NOTHING;
