-- Subscription tier limits (reference table)
CREATE TABLE IF NOT EXISTS subscription_tier_limits (
  tier                 VARCHAR(20) PRIMARY KEY,
  max_stations         INT NOT NULL,
  max_users            INT NOT NULL,
  max_songs            INT NOT NULL,
  max_sub_stations     INT NOT NULL DEFAULT 0,
  feature_dj           BOOLEAN NOT NULL DEFAULT FALSE,
  feature_analytics    BOOLEAN NOT NULL DEFAULT FALSE,
  feature_s3           BOOLEAN NOT NULL DEFAULT FALSE,
  feature_api_keys     BOOLEAN NOT NULL DEFAULT FALSE,
  feature_custom_roles BOOLEAN NOT NULL DEFAULT FALSE,
  feature_hierarchy    BOOLEAN NOT NULL DEFAULT FALSE
);

-- Tier definitions (use -1 for unlimited)
INSERT INTO subscription_tier_limits VALUES
  ('free',         1,  2,   500,  0, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE),
  ('starter',      3,  5,  2000,  0, TRUE,  FALSE, FALSE, FALSE, FALSE, FALSE),
  ('professional', 10, 25, 10000, 3, TRUE,  TRUE,  TRUE,  TRUE,  TRUE,  FALSE),
  ('enterprise',   -1, -1,    -1,-1, TRUE,  TRUE,  TRUE,  TRUE,  TRUE,  TRUE)
ON CONFLICT DO NOTHING;

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  stripe_subscription_id VARCHAR(255) UNIQUE,
  tier                   VARCHAR(20) NOT NULL DEFAULT 'free'
                           REFERENCES subscription_tier_limits(tier),
  status                 VARCHAR(20) NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'paused')),
  current_period_start   TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_company_active
  ON subscriptions(company_id)
  WHERE status IN ('active', 'trialing', 'past_due');

-- Seed free subscription for all existing companies
INSERT INTO subscriptions (company_id, tier, status)
SELECT id, 'free', 'active'
FROM companies
ON CONFLICT DO NOTHING;
