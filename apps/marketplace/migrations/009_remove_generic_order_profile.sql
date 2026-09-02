-- +goose Up
-- Generic was a temporary order-provider scaffold. Canonical order tables stay
-- shared by the two provider adapters, while existing Generic shops migrate to
-- SHOPEE_LIKE so their orders retain an executable lifecycle.
UPDATE shops SET provider_profile='SHOPEE_LIKE' WHERE provider_profile='GENERIC';
ALTER TABLE shops DROP CONSTRAINT IF EXISTS shops_provider_profile_check;
ALTER TABLE shops ADD CONSTRAINT shops_provider_profile_check
  CHECK (provider_profile IN ('SHOPEE_LIKE','TOKOPEDIA_LIKE'));
ALTER TABLE shops ALTER COLUMN provider_profile SET DEFAULT 'SHOPEE_LIKE';

-- +goose Down
ALTER TABLE shops DROP CONSTRAINT IF EXISTS shops_provider_profile_check;
ALTER TABLE shops ADD CONSTRAINT shops_provider_profile_check
  CHECK (provider_profile IN ('GENERIC','SHOPEE_LIKE','TOKOPEDIA_LIKE'));
ALTER TABLE shops ALTER COLUMN provider_profile SET DEFAULT 'GENERIC';
