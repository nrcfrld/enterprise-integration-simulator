-- +goose Up
-- Idempotency keys are claimed before a mutation executes. Existing rows were
-- already completed responses and remain replayable after this migration.
ALTER TABLE idempotency_keys ALTER COLUMN response_status DROP NOT NULL;
ALTER TABLE idempotency_keys ALTER COLUMN response_body DROP NOT NULL;
ALTER TABLE idempotency_keys ALTER COLUMN response_body TYPE BYTEA USING convert_to(response_body::text, 'UTF8');
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS request_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE idempotency_keys DROP CONSTRAINT IF EXISTS idempotency_keys_state_check;
ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_state_check
  CHECK (state IN ('PROCESSING','COMPLETED'));

-- +goose Down
ALTER TABLE idempotency_keys DROP CONSTRAINT IF EXISTS idempotency_keys_state_check;
ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS locked_until;
ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS state;
ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS request_hash;
DELETE FROM idempotency_keys WHERE response_status IS NULL OR response_body IS NULL;
ALTER TABLE idempotency_keys ALTER COLUMN response_body TYPE JSONB USING convert_from(response_body, 'UTF8')::jsonb;
ALTER TABLE idempotency_keys ALTER COLUMN response_status SET NOT NULL;
ALTER TABLE idempotency_keys ALTER COLUMN response_body SET NOT NULL;
