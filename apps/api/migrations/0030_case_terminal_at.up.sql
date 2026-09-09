-- Sub-project 2, Task 9 — when did a case actually end?
--
-- The twin reap deletes a de-identified copy some time after the case that
-- needed it closed, and nothing recorded when that was. `created_at`,
-- `accepted_at` and `answered_at` all existed; none of them answers "when did
-- this case finish". Measuring the window from `created_at` would reap the
-- twin of a case that opened four months ago and closed yesterday — precisely
-- when someone reopens a dispute and needs it.
--
-- Stamped by CasesService.transition() for any state the contract calls
-- terminal, so a future verb cannot forget it. `answered` is deliberately NOT
-- terminal: it still moves to `closed`.

ALTER TABLE cases_cases ADD COLUMN terminal_at timestamptz;

COMMENT ON COLUMN cases_cases.terminal_at IS
  'When the case reached a state it cannot leave. NULL while it is still live.';

-- Backfill is deliberately absent. Existing terminal cases get NULL, so their
-- twins are never reaped rather than being reaped against a guessed date. A
-- twin kept too long costs storage; one deleted too early costs a case.

-- ---------------------------------------------------------------------------
-- The reap's two windows into data no single user may see.
-- ---------------------------------------------------------------------------
--
-- The sweep runs system-wide across every organisation, so it cannot run as a
-- doctor. It runs as `admin`, which by design has NO read on patient imaging
-- (see the RLS test "admins cannot read patient imaging"). These two functions
-- are the narrow exception: they expose a study id and an Orthanc handle for
-- rows that are already finished, and nothing about a patient.

CREATE FUNCTION imaging_reapable_twins(p_before timestamptz)
RETURNS TABLE (study_id uuid, twin_orthanc_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.twin_orthanc_id
  FROM imaging_studies s
  WHERE app_current_role() = 'admin'
    AND s.twin_orthanc_id IS NOT NULL
    -- At least one case, and every one of them finished before the cutoff.
    -- A study never sent to a doctor keeps its twin: no case ever ended, so
    -- the window never started. It costs storage and loses nothing.
    AND EXISTS (SELECT 1 FROM cases_case_studies l WHERE l.study_id = s.id)
    AND NOT EXISTS (
      SELECT 1
      FROM cases_case_studies l
      JOIN cases_cases c ON c.id = l.case_id
      WHERE l.study_id = s.id
        AND (c.terminal_at IS NULL OR c.terminal_at >= p_before)
    );
$$;

COMMENT ON FUNCTION imaging_reapable_twins(timestamptz) IS
  'Twins whose every case ended before the cutoff. Ops-only; exposes no patient data.';

CREATE FUNCTION imaging_clear_twin(p_study uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  UPDATE imaging_studies
  SET twin_study_uid = NULL, twin_orthanc_id = NULL
  WHERE id = p_study AND app_current_role() = 'admin';
$$;

COMMENT ON FUNCTION imaging_clear_twin(uuid) IS
  'Forget a reaped twin. The study and its ORIGINAL are untouched (ADR-4).';

GRANT EXECUTE ON FUNCTION imaging_reapable_twins(timestamptz) TO mir_app;
GRANT EXECUTE ON FUNCTION imaging_clear_twin(uuid) TO mir_app;
