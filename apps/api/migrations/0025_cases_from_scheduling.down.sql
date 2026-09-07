-- Reverse of 0025.
--
-- This restores the STRUCTURE of the calendar, not its contents. The
-- availability windows and rules 0025 dropped are gone; a down migration
-- recreates tables, and inventing rows for them would be worse than an empty
-- calendar a doctor can refill.
--
-- The status mapping is lossy in one direction and says so: `submitted`,
-- `quoted` and `paid` all collapse back to `pending`, because the booking model
-- had no vocabulary for a priced-but-unpaid case. Applying up-then-down does
-- not round-trip those three, and no ordering of these statements would make it.

BEGIN;

DROP POLICY IF EXISTS cases_doctor            ON cases_cases;
DROP POLICY IF EXISTS cases_doctor_update     ON cases_cases;
DROP POLICY IF EXISTS cases_referring         ON cases_cases;
DROP POLICY IF EXISTS cases_referring_insert  ON cases_cases;
DROP POLICY IF EXISTS cases_referring_update  ON cases_cases;
DROP POLICY IF EXISTS cases_assistant         ON cases_cases;
DROP POLICY IF EXISTS cases_admin             ON cases_cases;
DROP POLICY IF EXISTS cases_admin_update      ON cases_cases;
DROP POLICY IF EXISTS case_studies_visible    ON cases_case_studies;
DROP POLICY IF EXISTS case_studies_insert     ON cases_case_studies;

ALTER TABLE billing_ledger_entries RENAME COLUMN case_id TO appointment_id;
ALTER INDEX billing_ledger_one_fee_per_org_per_case
  RENAME TO billing_ledger_one_fee_per_org_per_appointment;

DROP INDEX IF EXISTS cases_cases_open_idx;
DROP INDEX IF EXISTS cases_cases_org_idx;

ALTER TABLE cases_cases
  DROP CONSTRAINT IF EXISTS cases_quote_is_whole,
  DROP CONSTRAINT IF EXISTS cases_doctor_once_quoted,
  DROP COLUMN organisation_id,
  DROP COLUMN specialty,
  DROP COLUMN quoted_amount_minor,
  DROP COLUMN quoted_currency,
  DROP COLUMN quoted_at,
  DROP COLUMN quote_expires_at,
  DROP COLUMN accepted_at,
  DROP COLUMN answered_at,
  DROP COLUMN answer_due_at;

-- Booking required a doctor up front. Rows without one cannot be represented in
-- the old shape, so they go rather than acquiring an invented doctor.
DELETE FROM cases_case_studies WHERE case_id IN (SELECT id FROM cases_cases WHERE doctor_id IS NULL);
DELETE FROM billing_ledger_entries WHERE case_id IN (SELECT id FROM cases_cases WHERE doctor_id IS NULL);
DELETE FROM cases_cases WHERE doctor_id IS NULL;
ALTER TABLE cases_cases ALTER COLUMN doctor_id SET NOT NULL;

ALTER TABLE cases_cases DROP CONSTRAINT IF EXISTS cases_cases_status_check;
UPDATE cases_cases SET status = CASE status
  WHEN 'submitted' THEN 'pending'
  WHEN 'quoted'    THEN 'pending'
  WHEN 'paid'      THEN 'pending'
  WHEN 'accepted'  THEN 'confirmed'
  WHEN 'answered'  THEN 'completed'
  WHEN 'closed'    THEN 'completed'
  WHEN 'expired'   THEN 'cancelled'
  ELSE status
END;
ALTER TABLE cases_cases
  ALTER COLUMN status SET DEFAULT 'pending',
  ADD CONSTRAINT scheduling_appointments_status_check
    CHECK (status IN ('pending','confirmed','declined','cancelled','completed','no_show'));

ALTER TABLE cases_cases
  ADD COLUMN starts_at        timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN ends_at          timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  ADD COLUMN kind             text NOT NULL DEFAULT 'consultation'
                                CHECK (kind IN ('consultation','follow_up','imaging','other')),
  ADD COLUMN reminder_sent_at timestamptz;

ALTER TABLE cases_cases ADD CONSTRAINT scheduling_appointments_doctor_id_tstzrange_excl
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'cancelled');

CREATE TABLE scheduling_availability_rules (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  doctor_id    uuid NOT NULL REFERENCES identity_users(id),
  weekday      smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time   time NOT NULL,
  end_time     time NOT NULL,
  timezone     text NOT NULL,
  slot_minutes int  NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 240),
  valid_from   date NOT NULL,
  valid_until  date,
  withdrawn_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  CHECK (valid_until IS NULL OR valid_until >= valid_from)
);
CREATE INDEX scheduling_availability_rules_doctor_idx
  ON scheduling_availability_rules (doctor_id) WHERE withdrawn_at IS NULL;

CREATE TABLE scheduling_availability (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  doctor_id    uuid NOT NULL REFERENCES identity_users(id),
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  slot_minutes int NOT NULL DEFAULT 30,
  withdrawn_at timestamptz,
  rule_id      uuid REFERENCES scheduling_availability_rules(id),
  CHECK (ends_at > starts_at)
);
CREATE INDEX scheduling_availability_doctor_idx
  ON scheduling_availability (doctor_id, starts_at);
CREATE INDEX scheduling_availability_rule_idx
  ON scheduling_availability (rule_id, starts_at) WHERE rule_id IS NOT NULL;

ALTER TABLE scheduling_availability       ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_availability       FORCE  ROW LEVEL SECURITY;
ALTER TABLE scheduling_availability_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_availability_rules FORCE  ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling_availability       TO mir_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling_availability_rules TO mir_app;

ALTER TABLE cases_case_studies RENAME COLUMN case_id TO appointment_id;
ALTER TABLE cases_case_studies RENAME TO scheduling_appointment_studies;
ALTER TABLE cases_cases        RENAME TO scheduling_appointments;

ALTER INDEX cases_cases_patient_idx      RENAME TO scheduling_appointments_patient_idx;
ALTER INDEX cases_cases_doctor_idx       RENAME TO scheduling_appointments_doctor_idx;
ALTER INDEX cases_case_studies_study_idx RENAME TO scheduling_appointment_studies_study_idx;

CREATE INDEX scheduling_appointments_doctor_day_idx
  ON scheduling_appointments (doctor_id, starts_at) WHERE status <> 'cancelled';

CREATE OR REPLACE FUNCTION app_triage_before_payment() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT COALESCE(current_setting('app.triage_before_payment', true), 'false') = 'true'; $$;

CREATE OR REPLACE FUNCTION app_has_appointment_with(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM scheduling_appointments
    WHERE patient_id = p_patient
      AND doctor_id = app_current_user_id()
      AND status <> 'cancelled'
  );
$$;

CREATE OR REPLACE FUNCTION app_study_linked_to_my_appointment(p_study uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM scheduling_appointment_studies sas
    JOIN scheduling_appointments a ON a.id = sas.appointment_id
    WHERE sas.study_id = p_study
      AND a.doctor_id = app_current_user_id()
      AND a.status NOT IN ('cancelled','declined')
      AND (app_triage_before_payment() OR a.status IN ('confirmed', 'completed'))
  );
$$;

CREATE OR REPLACE FUNCTION app_can_see_appointment(p_appointment uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM scheduling_appointments a
    WHERE a.id = p_appointment
      AND (
        (app_current_role() = 'tunisia_doctor' AND a.doctor_id = app_current_user_id())
        OR (app_current_role() = 'libya_doctor' AND app_created_patient(a.patient_id))
      )
  );
$$;

CREATE OR REPLACE FUNCTION app_can_see_study(p_study uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM imaging_studies s
    WHERE s.id = p_study
      AND (
        (app_current_role() = 'libya_doctor' AND s.uploaded_by = app_current_user_id())
        OR (app_current_role() = 'tunisia_doctor'
            AND app_study_linked_to_my_appointment(s.id)
            AND app_has_consent_for(s.patient_id))
      )
  );
$$;

-- Same reason as the up migration: the parameter name changes back.
DROP FUNCTION IF EXISTS billing_owing_organisation(uuid, text);

CREATE FUNCTION billing_owing_organisation(p_appointment uuid, p_side text)
RETURNS TABLE (organisation_id uuid, corridor_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT o.id, o.corridor_id
    FROM scheduling_appointments a
    JOIN patients_patients p ON p.id = a.patient_id
    JOIN identity_memberships m
      ON m.user_id = CASE WHEN p_side = 'source' THEN p.created_by_doctor ELSE a.doctor_id END
    JOIN identity_organisations o
      ON o.id = m.organisation_id AND o.side = p_side
   WHERE a.id = p_appointment
     AND app_current_role() = 'admin'
   LIMIT 1;
$$;

DROP POLICY IF EXISTS patients_receiving_doctor ON patients_patients;
CREATE POLICY patients_receiving_doctor ON patients_patients FOR SELECT
  USING (
    app_current_role() = 'tunisia_doctor'
    AND app_has_appointment_with(id)
    AND app_has_consent_for(id)
  );

DROP POLICY IF EXISTS studies_receiving_doctor ON imaging_studies;
CREATE POLICY studies_receiving_doctor ON imaging_studies FOR SELECT
  USING (
    app_current_role() = 'tunisia_doctor'
    AND app_study_linked_to_my_appointment(id)
    AND app_has_consent_for(patient_id)
  );

DROP FUNCTION IF EXISTS app_has_case_with(uuid);
DROP FUNCTION IF EXISTS app_study_linked_to_my_case(uuid);
DROP FUNCTION IF EXISTS app_can_see_case(uuid);

GRANT EXECUTE ON FUNCTION
  app_has_appointment_with(uuid), app_study_linked_to_my_appointment(uuid),
  app_can_see_appointment(uuid), app_can_see_study(uuid),
  app_triage_before_payment(), billing_owing_organisation(uuid, text)
TO mir_app;

COMMIT;
