BEGIN;

-- A double-tapped "submit" on a bad link created two cases. The web sends one
-- key per form, reused on every retry; a repeated key returns the case the
-- first request made instead of making another.
--
-- Scoped to the creator: a key is only unique within one user's submissions,
-- so one user can never collide with — or probe for — another's.
ALTER TABLE cases_cases
  ADD COLUMN idempotency_key text CHECK (char_length(idempotency_key) <= 128);

CREATE UNIQUE INDEX cases_cases_idempotency_idx
  ON cases_cases (created_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
