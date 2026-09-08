-- Sub-project 2 — the release gate and the twin's identity columns.
--
-- Under approach A the doctor reads ONLY the de-identified twin. A missing twin
-- is therefore not degraded service the way a missing thumbnail is: it is a
-- case the doctor cannot open. The database must refuse it independently of
-- whether the proxy resolved the right copy — that is the defence in depth the
-- twin is being paid for.
--
-- `status` already permitted 'quarantined' from migration 0001 and nothing has
-- ever set it. This is the migration that gives the state a meaning.

ALTER TABLE imaging_studies
  ADD COLUMN twin_study_uid  text,
  ADD COLUMN twin_orthanc_id text;

ALTER TABLE imaging_instances
  ADD COLUMN twin_sop_uid    text,
  ADD COLUMN twin_series_uid text;

-- A twin UID must be unique where present: two studies resolving to one twin
-- would serve one patient's imaging under another patient's case.
CREATE UNIQUE INDEX imaging_studies_twin_uid_idx
  ON imaging_studies (twin_study_uid) WHERE twin_study_uid IS NOT NULL;

COMMENT ON COLUMN imaging_studies.twin_study_uid IS
  'StudyInstanceUID of the anonymised copy. Fresh UID, not the original: '
  'reusing it would make Orthanc dedupe the twin into the original.';

-- The gate itself. A study the doctor is otherwise entitled to — linked to
-- their accepted case, with a live consent — still does not reach them until
-- its twin exists and it has cleared the burned-in check.
DROP POLICY IF EXISTS studies_receiving_doctor ON imaging_studies;
CREATE POLICY studies_receiving_doctor ON imaging_studies FOR SELECT
  USING (
    app_current_role() = 'tunisia_doctor'
    AND status = 'ready'
    AND app_study_linked_to_my_case(id)
    AND app_has_consent_for(patient_id)
  );
