BEGIN;
CREATE INDEX IF NOT EXISTS patients_patients_created_by_idx ON patients_patients (created_by_doctor);
DROP INDEX IF EXISTS patients_patients_created_by_created_idx;
CREATE INDEX IF NOT EXISTS cases_cases_doctor_idx ON cases_cases (doctor_id);
DROP INDEX IF EXISTS cases_cases_doctor_created_idx;
DROP INDEX IF EXISTS audit_events_occurred_at_idx;
DROP INDEX IF EXISTS imaging_studies_study_instance_uid_idx;
COMMIT;
