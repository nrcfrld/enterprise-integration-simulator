-- +goose Up
ALTER TABLE webhooks ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE webhook_deliveries DROP CONSTRAINT webhook_deliveries_status_check;
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_status_check
  CHECK (status IN ('PENDING','DELIVERED','FAILED','CANCELLED'));

-- +goose Down
UPDATE webhook_deliveries SET status='FAILED' WHERE status='CANCELLED';
ALTER TABLE webhook_deliveries DROP CONSTRAINT webhook_deliveries_status_check;
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_status_check
  CHECK (status IN ('PENDING','DELIVERED','FAILED'));
ALTER TABLE webhooks DROP COLUMN deleted_at;
