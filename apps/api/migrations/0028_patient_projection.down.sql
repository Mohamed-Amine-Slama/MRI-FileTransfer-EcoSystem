DROP FUNCTION IF EXISTS cases_patient_brief(uuid);

-- Restores the grant exactly as migration 0025 left it.
CREATE POLICY patients_receiving_doctor ON patients_patients FOR SELECT
  USING (
    app_current_role() = 'tunisia_doctor'
    AND app_has_case_with(id)
    AND app_has_consent_for(id)
  );
