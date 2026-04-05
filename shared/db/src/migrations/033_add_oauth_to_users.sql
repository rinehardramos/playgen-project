-- Add Google OAuth support to users table.
-- oauth_provider: e.g. 'google' (nullable — NULL for password-only accounts)
-- oauth_id: provider-specific user ID (Google's "sub" claim)
-- password_hash becomes nullable so OAuth-only users don't need a password.

ALTER TABLE users
  ADD COLUMN oauth_provider VARCHAR(50),
  ADD COLUMN oauth_id       VARCHAR(255),
  ALTER COLUMN password_hash DROP NOT NULL;

CREATE UNIQUE INDEX users_oauth_provider_oauth_id_idx
  ON users (oauth_provider, oauth_id)
  WHERE oauth_provider IS NOT NULL;
