-- +goose Up
ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS leased_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS deliveries_pending_idx
  ON webhook_deliveries(status, next_attempt_at)
  WHERE status = 'PENDING';

-- +goose Down
DROP INDEX IF EXISTS deliveries_pending_idx;
ALTER TABLE webhook_deliveries DROP COLUMN IF EXISTS leased_until;
