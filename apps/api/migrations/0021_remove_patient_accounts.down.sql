-- Local rollback only.
--
-- This recreates STRUCTURE, not data. Patient accounts and consent rows the up
-- migration deleted are gone; a consent row cannot be reconstructed from a
-- schema, and pretending otherwise by inserting a placeholder would fabricate
-- the exact evidence consent exists to provide.

BEGIN;

ALTER TABLE identity_users DROP CONSTRAINT IF EXISTS identity_users_role_check;
ALTER TABLE identity_users ADD CONSTRAINT identity_users_role_check
  CHECK (role IN ('libya_doctor','tunisia_doctor','patient','admin','applicant','assistant'));

ALTER TABLE patients_patients ADD COLUMN claimed_by_user uuid REFERENCES identity_users(id);
CREATE INDEX patients_patients_claimed_by_idx ON patients_patients (claimed_by_user);

CREATE OR REPLACE FUNCTION app_claimed_patient(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM patients_patients p
    WHERE p.id = p_patient AND p.claimed_by_user = app_current_user_id()
  );
$$;
GRANT EXECUTE ON FUNCTION app_claimed_patient(uuid) TO mir_app;

CREATE TABLE patients_claim_tokens (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  patient_id   uuid NOT NULL REFERENCES patients_patients(id),
  token_hash   text NOT NULL,
  phone_e164   text NOT NULL,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  issued_by    uuid NOT NULL REFERENCES identity_users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patients_claim_tokens_hash_idx    ON patients_claim_tokens (token_hash);
CREATE INDEX patients_claim_tokens_patient_idx ON patients_claim_tokens (patient_id);

ALTER TABLE patients_claim_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients_claim_tokens FORCE  ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON patients_claim_tokens TO mir_app;

CREATE POLICY claim_tokens_issuer_select ON patients_claim_tokens FOR SELECT
  USING (app_current_role() = 'libya_doctor' AND issued_by = app_current_user_id());
CREATE POLICY claim_tokens_issuer_insert ON patients_claim_tokens FOR INSERT
  WITH CHECK (app_current_role() = 'libya_doctor' AND issued_by = app_current_user_id());

-- Restore the predicates' patient branches.
CREATE OR REPLACE FUNCTION app_can_see_study(p_study uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM imaging_studies s
    WHERE s.id = p_study
      AND (
        (app_current_role() = 'libya_doctor'   AND s.uploaded_by = app_current_user_id())
        OR (app_current_role() = 'patient'     AND app_claimed_patient(s.patient_id))
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
        OR (app_current_role() = 'patient'      AND app_claimed_patient(a.patient_id))
        OR (app_current_role() = 'libya_doctor' AND app_created_patient(a.patient_id))
      )
  );
$$;

-- Restore the patient policies.
CREATE POLICY patients_claimed ON patients_patients FOR SELECT
  USING (app_current_role() = 'patient' AND claimed_by_user = app_current_user_id());

CREATE POLICY studies_patient ON imaging_studies FOR SELECT
  USING (app_current_role() = 'patient' AND app_claimed_patient(patient_id));

CREATE POLICY appointments_patient ON scheduling_appointments FOR SELECT
  USING (app_current_role() = 'patient' AND app_claimed_patient(patient_id));
CREATE POLICY appointments_patient_insert ON scheduling_appointments FOR INSERT
  WITH CHECK (app_current_role() = 'patient' AND app_claimed_patient(patient_id));
CREATE POLICY appointments_patient_update ON scheduling_appointments FOR UPDATE
  USING (app_current_role() = 'patient' AND app_claimed_patient(patient_id))
  WITH CHECK (app_claimed_patient(patient_id));

CREATE POLICY payments_patient ON billing_payments FOR SELECT
  USING (app_current_role() = 'patient' AND app_claimed_patient(patient_id));
CREATE POLICY payments_patient_insert ON billing_payments FOR INSERT
  WITH CHECK (app_current_role() = 'patient' AND app_claimed_patient(patient_id));

DROP POLICY IF EXISTS availability_bookable ON scheduling_availability;
CREATE POLICY availability_bookable ON scheduling_availability FOR SELECT
  USING (app_current_role() IN ('patient','libya_doctor'));

DROP POLICY IF EXISTS consent_referring_doctor_insert ON consent_records;
DROP POLICY IF EXISTS consent_referring_doctor_revoke ON consent_records;

CREATE POLICY consent_patient_select ON consent_records FOR SELECT
  USING (app_current_role() = 'patient' AND app_claimed_patient(patient_id));
CREATE POLICY consent_patient_insert ON consent_records FOR INSERT
  WITH CHECK (app_current_role() = 'patient' AND app_claimed_patient(patient_id));
CREATE POLICY consent_patient_revoke ON consent_records FOR UPDATE
  USING (app_current_role() = 'patient' AND app_claimed_patient(patient_id))
  WITH CHECK (app_claimed_patient(patient_id));

DROP INDEX IF EXISTS consent_records_attested_by_idx;
ALTER TABLE consent_records
  DROP CONSTRAINT IF EXISTS consent_document_sha256_is_hex,
  DROP COLUMN attested_by,
  DROP COLUMN document_object_key,
  DROP COLUMN document_sha256;

COMMIT;
