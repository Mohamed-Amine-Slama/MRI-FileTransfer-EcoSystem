DROP POLICY IF EXISTS studies_receiving_doctor ON imaging_studies;
-- Restores the policy exactly as migration 0025 left it.
CREATE POLICY studies_receiving_doctor ON imaging_studies FOR SELECT
  USING (
    app_current_role() = 'tunisia_doctor'
    AND app_study_linked_to_my_case(id)
    AND app_has_consent_for(patient_id)
  );

DROP INDEX IF EXISTS imaging_studies_twin_uid_idx;
ALTER TABLE imaging_instances DROP COLUMN IF EXISTS twin_series_uid;
ALTER TABLE imaging_instances DROP COLUMN IF EXISTS twin_sop_uid;
ALTER TABLE imaging_studies  DROP COLUMN IF EXISTS twin_orthanc_id;
ALTER TABLE imaging_studies  DROP COLUMN IF EXISTS twin_study_uid;
