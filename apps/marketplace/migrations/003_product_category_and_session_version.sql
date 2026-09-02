-- +goose Up
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Uncategorized';

ALTER TABLE shop_scenarios
  ADD COLUMN IF NOT EXISTS api_slow_probability INTEGER NOT NULL DEFAULT 100
  CHECK (api_slow_probability BETWEEN 0 AND 100);

CREATE INDEX IF NOT EXISTS products_shop_category_idx
  ON products(shop_id, category);

-- +goose Down
DROP INDEX IF EXISTS products_shop_category_idx;
ALTER TABLE products DROP COLUMN IF EXISTS category;
ALTER TABLE users DROP COLUMN IF EXISTS session_version;
ALTER TABLE shop_scenarios DROP COLUMN IF EXISTS api_slow_probability;
