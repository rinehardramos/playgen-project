-- Migration 041: Short-lived CSRF state tokens for social OAuth flows (issues #211, #212)
-- Each row is created when the admin initiates an OAuth flow and deleted after the callback completes.

CREATE TABLE IF NOT EXISTS social_oauth_states (
    state_token    VARCHAR(64) PRIMARY KEY,            -- cryptographically random hex string
    station_id     UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    platform       VARCHAR(20) NOT NULL,               -- 'facebook' | 'twitter'
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_verifier  TEXT,                               -- Twitter PKCE only; NULL for Facebook
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at     TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);

CREATE INDEX IF NOT EXISTS idx_social_oauth_states_expires
    ON social_oauth_states(expires_at);
