CREATE TABLE roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
    code        VARCHAR(50) NOT NULL,
    label       VARCHAR(100) NOT NULL,
    permissions TEXT[] NOT NULL DEFAULT '{}',
    UNIQUE(company_id, code)
);

-- Platform-level roles (company_id is NULL for super_admin)
INSERT INTO roles (code, label, permissions) VALUES
  ('super_admin', 'Super Admin', ARRAY[
    'company:read','company:write',
    'station:read','station:write',
    'library:read','library:write',
    'template:read','template:write',
    'playlist:read','playlist:write','playlist:approve','playlist:export',
    'analytics:read',
    'users:read','users:write',
    'rules:read','rules:write'
  ]);
