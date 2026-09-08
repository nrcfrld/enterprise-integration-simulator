-- +goose Up
-- Nullable snapshots distinguish legacy attempts from an empty HTTP body.
ALTER TABLE webhook_delivery_attempts
  ADD COLUMN request_body TEXT,
  ADD COLUMN request_url TEXT,
  ADD COLUMN provider_profile TEXT,
  ADD COLUMN signing_client_id TEXT,
  ADD COLUMN started_at TIMESTAMPTZ,
  ADD COLUMN http_attempted BOOLEAN,
  ADD COLUMN failure_code TEXT,
  ADD COLUMN failure_reason TEXT,
  ADD COLUMN response_body_truncated BOOLEAN;

-- +goose Down
ALTER TABLE webhook_delivery_attempts
  DROP COLUMN request_body,
  DROP COLUMN request_url,
  DROP COLUMN provider_profile,
  DROP COLUMN signing_client_id,
  DROP COLUMN started_at,
  DROP COLUMN http_attempted,
  DROP COLUMN failure_code,
  DROP COLUMN failure_reason,
  DROP COLUMN response_body_truncated;
