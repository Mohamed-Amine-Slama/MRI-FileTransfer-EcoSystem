-- Local rollback only. The allocated references are dropped with the column and
-- are not recoverable: a reference a provider has already been given cannot be
-- reconstructed from a counter, because the counter only knows the last one.

BEGIN;

ALTER TABLE scheduling_appointments
  DROP CONSTRAINT IF EXISTS scheduling_appointments_case_ref_unique,
  DROP CONSTRAINT IF EXISTS scheduling_appointments_case_ref_format;

ALTER TABLE scheduling_appointments DROP COLUMN IF EXISTS case_ref;

DROP FUNCTION IF EXISTS scheduling_next_case_ref();
DROP TABLE IF EXISTS scheduling_case_ref_counters;

COMMIT;
