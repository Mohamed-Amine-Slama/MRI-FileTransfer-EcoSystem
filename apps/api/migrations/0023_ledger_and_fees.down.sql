-- Local rollback only.
--
-- Ledger entries and fee-schedule rows are dropped with their tables and are
-- not restored. Neither are the payment rows the up migration destroyed: a
-- captured charge cannot be reconstructed from a schema, and inserting a
-- placeholder would fabricate the exact record a payment row exists to be.
--
-- billing_payments and billing_webhook_events come back as 0007 defined them,
-- MINUS the two `payments_patient*` policies — migration 0021 dropped those
-- along with the role they name, and re-creating them here would reference an
-- app_claimed_patient() that no longer exists.

BEGIN;

-- ---------------------------------------------------------------------------
-- The imaging predicate, back to the single-status form. Safe only because
-- 'declined' ceases to exist below.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_study_linked_to_my_appointment(p_study uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM scheduling_appointment_studies sas
    JOIN scheduling_appointments a ON a.id = sas.appointment_id
    WHERE sas.study_id = p_study
      AND a.doctor_id = app_current_user_id()
      AND a.status <> 'cancelled'
      AND (app_triage_before_payment() OR a.status IN ('confirmed', 'completed'))
  );
$$;

-- ---------------------------------------------------------------------------
-- The appointment status machine, back to the payment-era set.
-- ---------------------------------------------------------------------------
ALTER TABLE scheduling_appointments
  DROP CONSTRAINT IF EXISTS scheduling_appointments_doctor_id_tstzrange_excl;

ALTER TABLE scheduling_appointments
  ADD CONSTRAINT scheduling_appointments_doctor_id_tstzrange_excl
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'cancelled');

ALTER TABLE scheduling_appointments DROP CONSTRAINT IF EXISTS scheduling_appointments_status_check;

-- 'pending' maps back to 'pending_payment' and 'declined' to 'cancelled'.
-- The second is LOSSY: the old set had no way to say "the receiving doctor
-- refused", which is why this migration added one.
UPDATE scheduling_appointments SET status = 'pending_payment' WHERE status = 'pending';
UPDATE scheduling_appointments SET status = 'cancelled'       WHERE status = 'declined';

ALTER TABLE scheduling_appointments
  ALTER COLUMN status SET DEFAULT 'pending_payment',
  ADD CONSTRAINT scheduling_appointments_status_check
    CHECK (status IN ('pending_payment','authorised','confirmed','cancelled','completed','no_show'));

-- ---------------------------------------------------------------------------
-- The ledger.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS billing_owing_organisation(uuid, text);
DROP TABLE IF EXISTS billing_ledger_entries;
DROP TABLE IF EXISTS billing_fee_schedule;

-- ---------------------------------------------------------------------------
-- The payment tables, as 0007 defined them.
-- ---------------------------------------------------------------------------
CREATE TABLE billing_payments (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  appointment_id      uuid NOT NULL REFERENCES scheduling_appointments(id),
  patient_id          uuid NOT NULL REFERENCES patients_patients(id),
  amount_minor        bigint NOT NULL CHECK (amount_minor > 0),
  currency            text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  provider            text NOT NULL DEFAULT 'stripe',
  provider_intent_id  text UNIQUE,
  status              text NOT NULL DEFAULT 'requires_authorisation'
                        CHECK (status IN ('requires_authorisation','authorised','captured',
                                          'failed','cancelled','refunded')),
  failure_reason      text,
  idempotency_key     text NOT NULL UNIQUE,
  authorised_at       timestamptz,
  captured_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX billing_payments_appointment_idx ON billing_payments (appointment_id);
CREATE INDEX billing_payments_patient_idx ON billing_payments (patient_id);

CREATE TABLE billing_webhook_events (
  provider_event_id  text PRIMARY KEY,
  provider           text NOT NULL DEFAULT 'stripe',
  event_type         text NOT NULL,
  payment_id         uuid REFERENCES billing_payments(id),
  received_at        timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz
);

CREATE INDEX billing_webhook_events_received_idx ON billing_webhook_events (received_at);

ALTER TABLE billing_payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_payments       FORCE  ROW LEVEL SECURITY;
ALTER TABLE billing_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_webhook_events FORCE  ROW LEVEL SECURITY;

CREATE POLICY payments_admin ON billing_payments FOR SELECT
  USING (app_current_role() = 'admin');

CREATE POLICY webhook_events_system ON billing_webhook_events FOR ALL
  USING (app_current_role() = 'admin')
  WITH CHECK (app_current_role() = 'admin');

CREATE POLICY payments_system_update ON billing_payments FOR UPDATE
  USING (app_current_role() = 'admin')
  WITH CHECK (app_current_role() = 'admin');

GRANT SELECT, INSERT, UPDATE ON billing_payments, billing_webhook_events TO mir_app;

COMMIT;
