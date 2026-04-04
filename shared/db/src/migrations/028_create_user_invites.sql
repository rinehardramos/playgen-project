-- User invites table for the invite flow
CREATE TABLE user_invites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    role_id     UUID NOT NULL REFERENCES roles(id),
    email       VARCHAR(255) NOT NULL,
    station_ids UUID[] NOT NULL DEFAULT '{}',
    token_hash  VARCHAR(64) NOT NULL UNIQUE,
    invited_by  UUID NOT NULL REFERENCES users(id),
    expires_at  TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_invites_company ON user_invites(company_id);
CREATE INDEX idx_user_invites_token   ON user_invites(token_hash);
