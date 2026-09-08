-- Sub-project 2, leaks 1 and 2 — spec 2026-09-08-identifier-suppression-design.
--
-- RLS is ROW-level and has no column granularity, so "the receiving doctor may
-- see this patient" has always meant "may see every column of this patient":
-- name, phone, date of birth, national id. The application layer choosing not
-- to select a column is not an access control.
--
-- So the grant goes away entirely rather than narrowing. What the doctor is
-- actually entitled to — how old the patient is and their sex, both of which
-- change how imaging is read — arrives through a definer function instead.
--
-- CONSEQUENCE WORTH KNOWING: `CASE_COLUMNS` in cases.service.ts reaches the
-- name through LEFT JOIN patients_patients. RLS filters rows inside a join
-- exactly as it does in a top-level select, so dropping this policy makes that
-- query return NULL for a doctor with no TypeScript edited. A future
-- `SELECT p.full_name` written by someone who never read this file returns
-- nothing rather than a name. That is the point.

DROP POLICY IF EXISTS patients_receiving_doctor ON patients_patients;

-- Age, not date of birth. A DOB is an identifier; an age is a clinical fact.
-- Computed against the CASE's created_at rather than a study date: a case may
-- link zero studies or several, and an age that depends on which study you
-- picked is not a stable number.
--
-- Capped at 90. Ages above 89 are individually identifying in small
-- populations, which is why Safe Harbor draws the line there.
CREATE FUNCTION cases_patient_brief(p_case uuid)
RETURNS TABLE (age_years int, sex text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    LEAST(
      90,
      EXTRACT(YEAR FROM age(c.created_at::date, p.date_of_birth))::int
    ) AS age_years,
    p.sex
  FROM cases_cases c
  JOIN patients_patients p ON p.id = c.patient_id
  WHERE c.id = p_case
    AND app_current_role() = 'tunisia_doctor'
    AND c.doctor_id = app_current_user_id()
    AND app_has_consent_for(c.patient_id);
$$;

COMMENT ON FUNCTION cases_patient_brief(uuid) IS
  'Everything a receiving doctor is entitled to know about a patient. '
  'Definer-rights because the doctor holds no grant on patients_patients.';

GRANT EXECUTE ON FUNCTION cases_patient_brief(uuid) TO mir_app;
