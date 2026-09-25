-- Indexes for the queries that run on every request or scan whole tables.
--
-- Plain CREATE INDEX, not CONCURRENTLY: the migrator runs each file as one
-- multi-statement query, which PostgreSQL executes as a transaction block, and
-- CONCURRENTLY refuses to run inside one. The tables are small before launch.
-- Once they hold production volume, build indexes like these out of band with
-- CONCURRENTLY and ship only an IF NOT EXISTS here.

BEGIN;

-- StudyAccessService.authoriseStudyAccess looks a study up by UID alone on
-- EVERY DICOMweb request. The only index on the column is the composite
-- UNIQUE (patient_id, study_instance_uid), which cannot serve it: seq scan.
CREATE INDEX IF NOT EXISTS imaging_studies_study_instance_uid_idx
  ON imaging_studies (study_instance_uid);

-- AuditService.recent: ORDER BY occurred_at DESC LIMIT n with no filter. Every
-- existing audit index leads with another column, so the fastest-growing table
-- in the schema was sorted in full for a top-N read.
CREATE INDEX IF NOT EXISTS audit_events_occurred_at_idx
  ON audit_events (occurred_at DESC);

-- A receiving doctor's case list and a doctor's patient list: RLS narrows to
-- one doctor, the query sorts by created_at. Composites serve both the filter
-- and the sort; they also cover every lookup the single-column ones served.
CREATE INDEX IF NOT EXISTS cases_cases_doctor_created_idx
  ON cases_cases (doctor_id, created_at DESC);
DROP INDEX IF EXISTS cases_cases_doctor_idx;

CREATE INDEX IF NOT EXISTS patients_patients_created_by_created_idx
  ON patients_patients (created_by_doctor, created_at DESC);
DROP INDEX IF EXISTS patients_patients_created_by_idx;

COMMIT;
