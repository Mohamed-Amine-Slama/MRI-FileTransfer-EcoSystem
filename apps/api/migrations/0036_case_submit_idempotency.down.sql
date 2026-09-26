BEGIN;

DROP INDEX IF EXISTS cases_cases_idempotency_idx;
ALTER TABLE cases_cases DROP COLUMN IF EXISTS idempotency_key;

COMMIT;
