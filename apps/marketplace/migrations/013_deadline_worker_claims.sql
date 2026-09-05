-- +goose Up
-- A short lease lets multiple worker replicas claim disjoint deadline batches.
-- Expired leases are eligible again, so a crashed worker cannot strand orders.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deadline_claimed_until TIMESTAMPTZ;

DROP INDEX IF EXISTS orders_payment_expiry_idx;
DROP INDEX IF EXISTS orders_seller_deadline_idx;
CREATE INDEX orders_payment_expiry_idx
  ON orders(payment_expires_at, id)
  WHERE status='UNPAID' AND payment_status='PENDING';
CREATE INDEX orders_seller_deadline_idx
  ON orders(seller_deadline_at, id)
  WHERE status IN ('PAID','PROCESSING');

-- +goose Down
DROP INDEX IF EXISTS orders_seller_deadline_idx;
DROP INDEX IF EXISTS orders_payment_expiry_idx;
CREATE INDEX orders_payment_expiry_idx
  ON orders(payment_expires_at)
  WHERE status='UNPAID';
CREATE INDEX orders_seller_deadline_idx
  ON orders(seller_deadline_at)
  WHERE status IN ('PAID','PROCESSING');
ALTER TABLE orders DROP COLUMN IF EXISTS deadline_claimed_until;
