CREATE TABLE dj_show_manifests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dj_script_id  UUID NOT NULL UNIQUE REFERENCES dj_scripts(id) ON DELETE CASCADE,
    manifest      JSONB NOT NULL DEFAULT '[]',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dj_manifests_script ON dj_show_manifests(dj_script_id);
