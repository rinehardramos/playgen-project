-- Add station locale fields and data API keys for weather/news integrations
ALTER TABLE stations
    ADD COLUMN IF NOT EXISTS city             VARCHAR(100),
    ADD COLUMN IF NOT EXISTS country_code     VARCHAR(10)   DEFAULT 'PH',
    ADD COLUMN IF NOT EXISTS latitude         NUMERIC(9, 6),
    ADD COLUMN IF NOT EXISTS longitude        NUMERIC(9, 6),
    ADD COLUMN IF NOT EXISTS weather_api_key  TEXT,
    ADD COLUMN IF NOT EXISTS news_api_key     TEXT;
