-- +goose Up
-- Provider behavior is selected per shop. Existing integrations remain GENERIC.
ALTER TABLE shops ADD COLUMN IF NOT EXISTS provider_profile TEXT NOT NULL DEFAULT 'GENERIC';
ALTER TABLE shops DROP CONSTRAINT IF EXISTS shops_provider_profile_check;
ALTER TABLE shops ADD CONSTRAINT shops_provider_profile_check CHECK (provider_profile IN ('GENERIC','SHOPEE_LIKE','TOKOPEDIA_LIKE'));

-- Payment and seller-SLA facts belong to the order and are retained for audit.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_failure_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_deadline_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_actor TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
UPDATE orders SET payment_status='PAID' WHERE paid_at IS NOT NULL;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check CHECK (payment_status IN ('PENDING','PAID','FAILED','EXPIRED'));

-- A package is the fulfillment unit. A shipment supplies logistics data for it.
CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'READY_TO_SHIP' CHECK (status IN ('READY_TO_SHIP','SHIPPED','IN_DELIVERY','DELIVERED','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS package_items (
  package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY(package_id, order_item_id)
);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS package_id TEXT REFERENCES packages(id) ON DELETE CASCADE;
ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_order_id_key;

-- Preserve existing shipment history by giving every legacy shipment one package.
INSERT INTO packages(id,order_id,status,created_at,updated_at)
SELECT 'pkg_legacy_' || s.id, s.order_id,
  CASE s.status WHEN 'DELIVERED' THEN 'DELIVERED' WHEN 'IN_DELIVERY' THEN 'IN_DELIVERY' WHEN 'SHIPPED' THEN 'SHIPPED' ELSE 'READY_TO_SHIP' END,
  s.created_at, s.created_at
FROM shipments s
WHERE s.package_id IS NULL
ON CONFLICT (id) DO NOTHING;
UPDATE shipments SET package_id='pkg_legacy_' || id WHERE package_id IS NULL;
INSERT INTO package_items(package_id,order_item_id,quantity)
SELECT s.package_id, oi.id, oi.quantity
FROM shipments s JOIN order_items oi ON oi.order_id=s.order_id
ON CONFLICT (package_id,order_item_id) DO NOTHING;
CREATE INDEX IF NOT EXISTS packages_order_created_idx ON packages(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_payment_expiry_idx ON orders(payment_expires_at) WHERE status='UNPAID';
CREATE INDEX IF NOT EXISTS orders_seller_deadline_idx ON orders(seller_deadline_at) WHERE status IN ('PAID','PROCESSING');

-- +goose Down
DROP INDEX IF EXISTS orders_seller_deadline_idx;
DROP INDEX IF EXISTS orders_payment_expiry_idx;
DROP INDEX IF EXISTS packages_order_created_idx;
ALTER TABLE shipments DROP COLUMN IF EXISTS package_id;
DROP TABLE IF EXISTS package_items;
DROP TABLE IF EXISTS packages;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders DROP COLUMN IF EXISTS cancellation_reason;
ALTER TABLE orders DROP COLUMN IF EXISTS cancellation_actor;
ALTER TABLE orders DROP COLUMN IF EXISTS seller_deadline_at;
ALTER TABLE orders DROP COLUMN IF EXISTS payment_failure_reason;
ALTER TABLE orders DROP COLUMN IF EXISTS payment_failed_at;
ALTER TABLE orders DROP COLUMN IF EXISTS payment_expires_at;
ALTER TABLE orders DROP COLUMN IF EXISTS payment_status;
ALTER TABLE shops DROP CONSTRAINT IF EXISTS shops_provider_profile_check;
ALTER TABLE shops DROP COLUMN IF EXISTS provider_profile;
