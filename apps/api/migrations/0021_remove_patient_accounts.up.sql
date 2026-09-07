-- Patients are records, not accounts.
--
-- The referring Libyan doctor creates the patient and assigns them to a
-- receiving Tunisian doctor. Nobody signs in as a patient, so there is no
-- session to scope and no policy that can name one.
--
-- WHAT THIS MIGRATION IS CAREFUL NOT TO BREAK.
-- `app_has_consent_for(uuid)` keeps its exact signature AND its exact
-- semantics. It gates the receiving doctor's access to demographics
-- (0002_rls.up.sql:303) and to imaging (:200, :365) — the policies the P3.2
-- gate tests directly. Only the WRITER of a consent row changes here. A
-- migration that redefined that function would be rewriting the access-control
-- core under cover of a role removal.
--
-- WHY CONSENT SURVIVES AT ALL.
-- Removing the patient's login does not remove the patient's consent. The
-- patient signs on paper; the doctor attests they hold it and uploads the
-- scan. `evidence_hash` keeps its meaning (the hash of the rendered terms) and
-- `document_sha256` is a SECOND, separate hash of the signed artefact, because
-- a dispute needs to tell "these were the terms" from "this is what they
-- signed".
--
-- WHY `availability_bookable` IS REWRITTEN RATHER THAN DROPPED.
-- Migration 0014 fixed this policy once already: it admitted only 'patient',
-- so the referring doctor's slot picker was always empty and reported a
-- fully-booked specialist as having published nothing. Dropping it now would
-- reintroduce that bug from the other direction — the Libyan doctor is the
-- only one left who books, and a policy that admits nobody is the same broken
-- screen with a different cause.

BEGIN;

-- ---------------------------------------------------------------------------
-- Consent becomes an attestation. Columns first: the new policies reference
-- them, and the backfill needs a value before NOT NULL can be applied.
-- ---------------------------------------------------------------------------
ALTER TABLE consent_records
  ADD COLUMN attested_by          uuid REFERENCES identity_users(id),
  ADD COLUMN document_object_key  text,
  ADD COLUMN document_sha256      text;

-- There is no production data (README: no real patients, no infrastructure),
-- so any row present is local or test data. Deleting it is honest: a consent
-- row from the old model has no attesting doctor and no signed document, and
-- inventing either would fabricate evidence.
DELETE FROM consent_records;

ALTER TABLE consent_records
  ALTER COLUMN attested_by         SET NOT NULL,
  ALTER COLUMN document_object_key SET NOT NULL,
  ALTER COLUMN document_sha256     SET NOT NULL,
  ADD CONSTRAINT consent_document_sha256_is_hex
    CHECK (document_sha256 ~ '^[0-9a-f]{64}$');

CREATE INDEX consent_records_attested_by_idx ON consent_records (attested_by);

-- ---------------------------------------------------------------------------
-- Every policy that names the patient role.
--
-- Dropped BEFORE the role leaves the CHECK constraint and before
-- app_claimed_patient() is dropped: a policy referencing a value the
-- constraint forbids is dead code that still evaluates, and dead
-- access-control code is how a system fails open later.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS consent_patient_select      ON consent_records;
DROP POLICY IF EXISTS consent_patient_insert      ON consent_records;
DROP POLICY IF EXISTS consent_patient_revoke      ON consent_records;
DROP POLICY IF EXISTS patients_claimed            ON patients_patients;
DROP POLICY IF EXISTS studies_patient             ON imaging_studies;
DROP POLICY IF EXISTS appointments_patient        ON scheduling_appointments;
DROP POLICY IF EXISTS appointments_patient_insert ON scheduling_appointments;
DROP POLICY IF EXISTS appointments_patient_update ON scheduling_appointments;
DROP POLICY IF EXISTS payments_patient            ON billing_payments;
DROP POLICY IF EXISTS payments_patient_insert     ON billing_payments;
DROP POLICY IF EXISTS claim_tokens_issuer_select  ON patients_claim_tokens;
DROP POLICY IF EXISTS claim_tokens_issuer_insert  ON patients_claim_tokens;

-- Published availability is not patient data — it is a doctor's opening hours
-- — so this reveals nothing about anyone's care. The referring doctor is now
-- the only role that books.
DROP POLICY IF EXISTS availability_bookable ON scheduling_availability;
CREATE POLICY availability_bookable ON scheduling_availability FOR SELECT
  USING (app_current_role() = 'libya_doctor');

-- The referring doctor attests, for a patient they created, as themselves.
-- All three conditions are required: without the third, a doctor could file an
-- attestation in a colleague's name.
CREATE POLICY consent_referring_doctor_insert ON consent_records FOR INSERT
  WITH CHECK (
    app_current_role() = 'libya_doctor'
    AND app_created_patient(patient_id)
    AND attested_by = app_current_user_id()
  );

-- Revocation still sets revoked_at and never deletes: the record of consent
-- having been granted is itself the evidence.
CREATE POLICY consent_referring_doctor_revoke ON consent_records FOR UPDATE
  USING (app_current_role() = 'libya_doctor' AND app_created_patient(patient_id))
  WITH CHECK (app_created_patient(patient_id));

-- ---------------------------------------------------------------------------
-- The claim flow, in full.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS patients_claim_with_token(text);
DROP TABLE IF EXISTS patients_claim_tokens;

DROP INDEX IF EXISTS patients_patients_claimed_by_idx;
ALTER TABLE patients_patients DROP COLUMN claimed_by_user;

-- ---------------------------------------------------------------------------
-- The two SECURITY DEFINER predicates that branch on the patient role.
-- Rewritten rather than dropped: both are still needed by the roles that
-- remain, and both are referenced by policies on dependent tables.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_can_see_study(p_study uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM imaging_studies s
    WHERE s.id = p_study
      AND (
        (app_current_role() = 'libya_doctor'   AND s.uploaded_by = app_current_user_id())
        OR (app_current_role() = 'tunisia_doctor'
            AND app_study_linked_to_my_appointment(s.id)
            AND app_has_consent_for(s.patient_id))
      )
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

-- Dropped last: the policies and functions above referenced it.
DROP FUNCTION IF EXISTS app_claimed_patient(uuid);

-- ---------------------------------------------------------------------------
-- The role itself.
--
-- WHAT A PATIENT ACCOUNT LEAVES BEHIND. Every foreign key into identity_users
-- is NO ACTION, so deleting the accounts without clearing what points at them
-- fails on the first dependent row. The rows fall into two kinds, and they are
-- treated differently on purpose:
--
--  * ACCOUNT FURNITURE — preferences and email verifications. These exist only
--    to serve a login. With no login they describe nothing, so they go.
--
--  * CLINICAL WORK the patient happened to author. A patient could book their
--    own appointment under `appointments_patient_insert`, and that booking is a
--    real slot with a real doctor. Deleting it would throw away scheduling data
--    to remove an account, so `created_by` is REPOINTED to the doctor who
--    created the patient record — which is exactly who would have booked it
--    under the new model. `patient_id` already says whose appointment it is, so
--    nothing about the booking becomes less true.
--
-- Anything else — a membership, an invitation, an organisation decision — a
-- patient could never have had, because every one of those paths is role-gated
-- to staff. If one exists anyway, the foreign key still fires and this
-- migration fails loudly. That is the correct outcome: an unexplained row is
-- not something to delete quietly.
-- ---------------------------------------------------------------------------
DELETE FROM identity_user_preferences
  WHERE user_id IN (SELECT id FROM identity_users WHERE role = 'patient');

DELETE FROM identity_email_verifications
  WHERE user_id IN (SELECT id FROM identity_users WHERE role = 'patient');

UPDATE scheduling_appointments a
   SET created_by = p.created_by_doctor
  FROM patients_patients p
 WHERE p.id = a.patient_id
   AND a.created_by IN (SELECT id FROM identity_users WHERE role = 'patient');

UPDATE imaging_studies s
   SET uploaded_by = p.created_by_doctor
  FROM patients_patients p
 WHERE p.id = s.patient_id
   AND s.uploaded_by IN (SELECT id FROM identity_users WHERE role = 'patient');

UPDATE imaging_upload_sessions u
   SET created_by = p.created_by_doctor
  FROM patients_patients p
 WHERE p.id = u.patient_id
   AND u.created_by IN (SELECT id FROM identity_users WHERE role = 'patient');

DELETE FROM identity_users WHERE role = 'patient';

ALTER TABLE identity_users DROP CONSTRAINT IF EXISTS identity_users_role_check;
ALTER TABLE identity_users ADD CONSTRAINT identity_users_role_check
  CHECK (role IN ('libya_doctor','tunisia_doctor','admin','applicant','assistant'));

COMMIT;
