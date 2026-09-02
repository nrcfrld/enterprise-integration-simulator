-- +goose Up
-- Reservations keep sellable stock and a durable audit trail separate. Existing
-- `products.stock` remains the externally visible available quantity.
CREATE TABLE IF NOT EXISTS inventory_reservations (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id TEXT NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMMITTED','RELEASED')),
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS inventory_reservations_order_idx ON inventory_reservations(order_id, status);

-- Existing deductions represented implicit reservations. Mark historical paid
-- and completed orders committed so later cancellation cannot restore stock.
INSERT INTO inventory_reservations(id,order_id,order_item_id,product_id,quantity,status,committed_at)
SELECT 'res_legacy_' || oi.id,oi.order_id,oi.id,oi.product_id,oi.quantity,
  CASE WHEN o.status IN ('CANCELLED','RETURNED') THEN 'RELEASED' ELSE 'COMMITTED' END,
  CASE WHEN o.status IN ('CANCELLED','RETURNED') THEN NULL ELSE now() END
FROM order_items oi JOIN orders o ON o.id=oi.order_id
WHERE oi.product_id IS NOT NULL
ON CONFLICT (order_item_id) DO NOTHING;

ALTER TABLE credentials ADD COLUMN IF NOT EXISTS access_token_ciphertext TEXT;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('UNPAID','PAID','PROCESSING','READY_TO_SHIP','SHIPPED','IN_DELIVERY','DELIVERED','COMPLETED','CANCELLED','RETURNED'));

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS delivery_failure_reason TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS returning_at TIMESTAMPTZ;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;
ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_status_check;
ALTER TABLE shipments ADD CONSTRAINT shipments_status_check
  CHECK (status IN ('CREATED','SHIPPED','IN_DELIVERY','DELIVERED','DELIVERY_FAILED','RETURNING','RETURNED'));
ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_status_check;
ALTER TABLE packages ADD CONSTRAINT packages_status_check
  CHECK (status IN ('READY_TO_SHIP','SHIPPED','IN_DELIVERY','DELIVERED','DELIVERY_FAILED','RETURNING','RETURNED','CANCELLED'));

-- +goose Down
ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_status_check;
ALTER TABLE packages ADD CONSTRAINT packages_status_check CHECK (status IN ('READY_TO_SHIP','SHIPPED','IN_DELIVERY','DELIVERED','CANCELLED'));
ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_status_check;
ALTER TABLE shipments ADD CONSTRAINT shipments_status_check CHECK (status IN ('CREATED','SHIPPED','IN_DELIVERY','DELIVERED'));
ALTER TABLE shipments DROP COLUMN IF EXISTS returned_at;
ALTER TABLE shipments DROP COLUMN IF EXISTS returning_at;
ALTER TABLE shipments DROP COLUMN IF EXISTS failed_at;
ALTER TABLE shipments DROP COLUMN IF EXISTS delivery_failure_reason;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('UNPAID','PAID','PROCESSING','READY_TO_SHIP','SHIPPED','IN_DELIVERY','DELIVERED','COMPLETED','CANCELLED'));
ALTER TABLE credentials DROP COLUMN IF EXISTS access_token_ciphertext;
DROP INDEX IF EXISTS inventory_reservations_order_idx;
DROP TABLE IF EXISTS inventory_reservations;
