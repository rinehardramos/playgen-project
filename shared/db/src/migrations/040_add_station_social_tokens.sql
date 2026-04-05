-- Migration 040: Station social OAuth tokens (issues #211 Facebook, #212 Twitter)
-- Stores encrypted OAuth tokens for social platform integrations per station.
-- Tokens are separate from the stations table (which stores only public handles/IDs in migration 039).

CREATE TABLE IF NOT EXISTS station_social_tokens (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id           UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    platform             VARCHAR(20) NOT NULL,         -- 'facebook' | 'twitter'
    -- AES-256-GCM encrypted token strings (format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>")
    access_token_enc     TEXT NOT NULL,                -- Facebook: long-lived page access token; Twitter: OAuth 2.0 access token
    refresh_token_enc    TEXT,                         -- Twitter only: refresh token (NULL for Facebook)
    expires_at           TIMESTAMPTZ,                  -- Twitter only: access token expiry (~2h); NULL for Facebook
    -- Account info for display (not sensitive)
    external_account_id  VARCHAR(200),                 -- Facebook: page_id; Twitter: user_id
    external_account_name VARCHAR(200),                -- Facebook: page_name; Twitter: @username
    -- Audit
    connected_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    connected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(station_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_station_social_tokens_station
    ON station_social_tokens(station_id);
