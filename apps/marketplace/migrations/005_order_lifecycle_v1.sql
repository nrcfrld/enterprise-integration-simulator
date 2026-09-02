-- +goose Up
-- Preserve existing simulator data while replacing the obsolete lifecycle.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
UPDATE orders
SET status = CASE status
  WHEN 'CREATED' THEN 'UNPAID'
  WHEN 'CONFIRMED' THEN 'PAID'
  ELSE status
END;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('UNPAID','PAID','PROCESSING','READY_TO_SHIP','SHIPPED','IN_DELIVERY','DELIVERED','COMPLETED','CANCELLED'));

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_reference TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
UPDATE orders
SET payment_reference = COALESCE(payment_reference, 'legacy_' || id),
    paid_at = COALESCE(paid_at, created_at)
WHERE status IN ('PAID','PROCESSING','READY_TO_SHIP','SHIPPED','IN_DELIVERY','DELIVERED','COMPLETED');

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS pickup_type TEXT NOT NULL DEFAULT 'PICKUP';
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE shipments ALTER COLUMN shipped_at DROP NOT NULL;
ALTER TABLE shipments ALTER COLUMN shipped_at DROP DEFAULT;
ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_status_check;
ALTER TABLE shipments
  ADD CONSTRAINT shipments_status_check
  CHECK (status IN ('CREATED','SHIPPED','IN_DELIVERY','DELIVERED'));

-- +goose Down
ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_status_check;
UPDATE shipments
SET status = CASE status
  WHEN 'CREATED' THEN 'SHIPPED'
  WHEN 'IN_DELIVERY' THEN 'SHIPPED'
  ELSE status
END,
    shipped_at = COALESCE(shipped_at, created_at, now());
ALTER TABLE shipments ALTER COLUMN shipped_at SET DEFAULT now();
ALTER TABLE shipments ALTER COLUMN shipped_at SET NOT NULL;
ALTER TABLE shipments DROP COLUMN IF EXISTS created_at;
ALTER TABLE shipments DROP COLUMN IF EXISTS pickup_type;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
UPDATE orders
SET status = CASE status
  WHEN 'UNPAID' THEN 'CREATED'
  WHEN 'PAID' THEN 'CONFIRMED'
  WHEN 'READY_TO_SHIP' THEN 'PROCESSING'
  WHEN 'IN_DELIVERY' THEN 'SHIPPED'
  ELSE status
END;
ALTER TABLE orders DROP COLUMN IF EXISTS paid_at;
ALTER TABLE orders DROP COLUMN IF EXISTS payment_reference;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('CREATED','CONFIRMED','PROCESSING','SHIPPED','DELIVERED','COMPLETED','CANCELLED'));
