-- The scheduling module becomes the cases module.
--
-- WHY THIS IS A RENAME AND NOT A NEW TABLE. `scheduling_appointments` has been
-- the case record in everything but name since migration 0024 put `case_ref`
-- on it. 0023 keyed `billing_ledger_entries` to it by foreign key. 0021
-- rewrote its policies. Most of all, this table is the subject of the
-- SECURITY DEFINER predicates the P3.2 gate tests exercise, and 0021's own
-- header states the rule: a migration that redefines those functions is
-- rewriting the access-control core under cover of a refactor. So the table is
-- renamed and the predicates are rewritten deliberately, here, with the gate
-- tests as the bar.
--
-- WHY THE FUNCTIONS MUST BE REPLACED IN THIS SAME MIGRATION. A classic
-- `LANGUAGE sql` function stores its body as TEXT and re-resolves the names at
-- first execution. `ALTER TABLE ... RENAME` does not rewrite that text.
-- Renaming without replacing leaves every policy that calls one failing at
-- runtime with `relation "scheduling_appointments" does not exist` — a broken
-- database that reads like a broken migration.
--
-- THE ONE SEMANTIC CHANGE is in app_study_linked_to_my_case: imaging unlocks on
-- ACCEPTANCE, not on payment. D3's triage-before-payment toggle is gone,
-- because a summary before acceptance is now the flow rather than a
-- configuration of it, and a config key that can no longer be false is a lie in
-- the schema.
--
-- WHAT LEAVES, AND WHY IT IS SAFE. There are no slots, so there is nothing to
-- double-book: the gist exclusion constraint and its btree_gist dependency go,
-- along with starts_at/ends_at/kind/reminder_sent_at and the availability
-- tables. `no_show` goes with them — 0014 added it deliberately and 0023
-- defended it, but the verb has no referent once attendance does not exist.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tables and indexes.
-- ---------------------------------------------------------------------------
ALTER TABLE scheduling_appointments        RENAME TO cases_cases;
ALTER TABLE scheduling_appointment_studies RENAME TO cases_case_studies;
ALTER TABLE cases_case_studies             RENAME COLUMN appointment_id TO case_id;

ALTER INDEX scheduling_appointments_patient_idx      RENAME TO cases_cases_patient_idx;
ALTER INDEX scheduling_appointments_doctor_idx       RENAME TO cases_cases_doctor_idx;
ALTER INDEX scheduling_appointment_studies_study_idx RENAME TO cases_case_studies_study_idx;

-- The agenda index was "this doctor, this day". There is no day any more.
DROP INDEX IF EXISTS scheduling_appointments_doctor_day_idx;

-- ---------------------------------------------------------------------------
-- 2. The calendar leaves.
-- ---------------------------------------------------------------------------
ALTER TABLE cases_cases
  DROP CONSTRAINT IF EXISTS scheduling_appointments_doctor_id_tstzrange_excl;

DROP TABLE IF EXISTS scheduling_availability_rules CASCADE;
DROP TABLE IF EXISTS scheduling_availability CASCADE;

ALTER TABLE cases_cases
  DROP COLUMN starts_at,
  DROP COLUMN ends_at,
  DROP COLUMN kind,
  DROP COLUMN reminder_sent_at;

-- ---------------------------------------------------------------------------
-- 3. The status machine.
--
-- pending   -> submitted   (referred, not yet priced)
-- confirmed -> accepted    (the doctor took it)
-- completed -> answered    (a diagnosis exists)
-- no_show   -> cancelled   (the verb is gone; the case is not)
-- ---------------------------------------------------------------------------
ALTER TABLE cases_cases DROP CONSTRAINT IF EXISTS scheduling_appointments_status_check;

UPDATE cases_cases SET status = CASE status
  WHEN 'pending'   THEN 'submitted'
  WHEN 'confirmed' THEN 'accepted'
  WHEN 'completed' THEN 'answered'
  WHEN 'no_show'   THEN 'cancelled'
  ELSE status
END;

ALTER TABLE cases_cases
  ALTER COLUMN status SET DEFAULT 'submitted',
  ADD CONSTRAINT cases_cases_status_check CHECK (status IN (
    'submitted','quoted','paid','accepted','answered','closed',
    'declined','cancelled','expired'
  ));

-- ---------------------------------------------------------------------------
-- 4. What a case now carries.
--
-- `organisation_id` is STORED rather than joined. Today the debtor is derived
-- through patients_patients.created_by_doctor -> identity_memberships, which
-- silently follows a clinician to a new employer and would re-attribute a
-- settled case. Who owed the money is a fact of the case, not of the current
-- staffing.
--
-- `specialty` is fixed at submission for the same reason: pricing reads it, and
-- it must not follow the doctor's profile if that later changes.
-- ---------------------------------------------------------------------------
-- A submitted case has no doctor. One is chosen at QUOTE, because the doctor's
-- earned tier is a term in the price — so there is no moment where a case has a
-- doctor but no price, and none where it has a price but no doctor. Booking
-- required a doctor up front; consulting does not.
ALTER TABLE cases_cases ALTER COLUMN doctor_id DROP NOT NULL;

ALTER TABLE cases_cases
  ADD COLUMN organisation_id      uuid REFERENCES identity_organisations(id),
  ADD COLUMN specialty            text,
  ADD COLUMN quoted_amount_minor  bigint CHECK (quoted_amount_minor > 0),
  ADD COLUMN quoted_currency      text CHECK (quoted_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN quoted_at            timestamptz,
  ADD COLUMN quote_expires_at     timestamptz,
  ADD COLUMN accepted_at          timestamptz,
  ADD COLUMN answered_at          timestamptz,
  ADD COLUMN answer_due_at        timestamptz;

-- A quote is one price, for one doctor, at one moment. Half a quote is not a
-- state the pricing rules can describe, so the database refuses to hold one.
-- Past `submitted`, a case has a doctor. Enforced here rather than in the
-- service so no code path can leave a paid case nobody is answering.
ALTER TABLE cases_cases ADD CONSTRAINT cases_doctor_once_quoted CHECK (
  status IN ('submitted','cancelled') OR doctor_id IS NOT NULL
);

ALTER TABLE cases_cases ADD CONSTRAINT cases_quote_is_whole CHECK (
  (quoted_amount_minor IS NULL AND quoted_currency IS NULL
   AND quoted_at IS NULL AND quote_expires_at IS NULL)
  OR
  (quoted_amount_minor IS NOT NULL AND quoted_currency IS NOT NULL
   AND quoted_at IS NOT NULL AND quote_expires_at IS NOT NULL)
);

UPDATE cases_cases c
   SET organisation_id = sub.org_id
  FROM (
    SELECT p.id AS patient_id, o.id AS org_id
      FROM patients_patients p
      JOIN identity_memberships m   ON m.user_id = p.created_by_doctor
      JOIN identity_organisations o ON o.id = m.organisation_id AND o.side = 'source'
  ) sub
 WHERE sub.patient_id = c.patient_id;

UPDATE cases_cases c
   SET specialty = COALESCE(dp.specialty, 'unspecified')
  FROM identity_doctor_profiles dp
 WHERE dp.user_id = c.doctor_id;

-- Same honesty as 0021: there is no production data (README — no real
-- patients, no infrastructure), so a row that cannot be attributed to an
-- organisation is local or test data. Inventing a debtor would be worse than
-- admitting the gap.
DELETE FROM cases_case_studies WHERE case_id IN (
  SELECT id FROM cases_cases WHERE organisation_id IS NULL OR specialty IS NULL
);
DELETE FROM billing_ledger_entries WHERE appointment_id IN (
  SELECT id FROM cases_cases WHERE organisation_id IS NULL OR specialty IS NULL
);
DELETE FROM cases_cases WHERE organisation_id IS NULL OR specialty IS NULL;

ALTER TABLE cases_cases
  ALTER COLUMN organisation_id SET NOT NULL,
  ALTER COLUMN specialty       SET NOT NULL;

CREATE INDEX cases_cases_org_idx ON cases_cases (organisation_id, created_at DESC);
CREATE INDEX cases_cases_open_idx ON cases_cases (doctor_id, status)
  WHERE status IN ('paid','accepted');

ALTER TABLE billing_ledger_entries RENAME COLUMN appointment_id TO case_id;
ALTER INDEX billing_ledger_one_fee_per_org_per_appointment
  RENAME TO billing_ledger_one_fee_per_org_per_case;

-- ---------------------------------------------------------------------------
-- 5. The predicates. Renamed to match the tables, bodies rewritten.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_has_case_with(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM cases_cases
    WHERE patient_id = p_patient
      AND doctor_id = app_current_user_id()
      AND status NOT IN ('cancelled','declined','expired')
  );
$$;

-- Imaging unlocks on ACCEPTANCE. Before that the doctor has a summary and a
-- decision to make, which is the whole point of the triage step rather than a
-- configuration of it.
CREATE OR REPLACE FUNCTION app_study_linked_to_my_case(p_study uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM cases_case_studies ccs
    JOIN cases_cases c ON c.id = ccs.case_id
    WHERE ccs.study_id = p_study
      AND c.doctor_id = app_current_user_id()
      AND c.status IN ('accepted','answered','closed')
  );
$$;

CREATE OR REPLACE FUNCTION app_can_see_case(p_case uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM cases_cases c
    WHERE c.id = p_case
      AND (
        (app_current_role() = 'tunisia_doctor' AND c.doctor_id = app_current_user_id())
        OR (app_current_role() = 'libya_doctor' AND app_created_patient(c.patient_id))
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
            AND app_study_linked_to_my_case(s.id)
            AND app_has_consent_for(s.patient_id))
      )
  );
$$;

-- DROPPED, not replaced: the parameter is renamed from p_appointment to p_case,
-- and PostgreSQL refuses to rename an input parameter through CREATE OR
-- REPLACE ("cannot change name of input parameter"). The whole migration aborts
-- on it, which reads as a broken database rather than a one-line signature
-- change.
DROP FUNCTION IF EXISTS billing_owing_organisation(uuid, text);

CREATE FUNCTION billing_owing_organisation(p_case uuid, p_side text)
RETURNS TABLE (organisation_id uuid, corridor_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT o.id, o.corridor_id
    FROM cases_cases c
    JOIN identity_organisations o
      ON o.id = CASE
                  WHEN p_side = 'source' THEN c.organisation_id
                  ELSE (SELECT m.organisation_id
                          FROM identity_memberships m
                          JOIN identity_organisations d ON d.id = m.organisation_id
                         WHERE m.user_id = c.doctor_id AND d.side = 'destination'
                         LIMIT 1)
                END
   WHERE c.id = p_case
     AND app_current_role() = 'admin'
   LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 6. Policies. `ALTER TABLE ... RENAME` carries policies across, but their
--    names and bodies still say "appointment", and the ones that called a
--    now-dropped function would fail at first use. Recreate them.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS appointments_doctor            ON cases_cases;
DROP POLICY IF EXISTS appointments_doctor_update     ON cases_cases;
DROP POLICY IF EXISTS appointments_doctor_insert     ON cases_cases;
DROP POLICY IF EXISTS appointments_referring_doctor  ON cases_cases;
DROP POLICY IF EXISTS appointments_referring_update  ON cases_cases;
DROP POLICY IF EXISTS appointments_admin             ON cases_cases;
DROP POLICY IF EXISTS appointments_admin_update      ON cases_cases;
DROP POLICY IF EXISTS appointment_studies_visible    ON cases_case_studies;
DROP POLICY IF EXISTS appointment_studies_insert     ON cases_case_studies;

CREATE POLICY cases_doctor ON cases_cases FOR SELECT
  USING (app_current_role() = 'tunisia_doctor' AND doctor_id = app_current_user_id());

CREATE POLICY cases_doctor_update ON cases_cases FOR UPDATE
  USING (app_current_role() = 'tunisia_doctor' AND doctor_id = app_current_user_id())
  WITH CHECK (doctor_id = app_current_user_id());

CREATE POLICY cases_referring ON cases_cases FOR SELECT
  USING (app_current_role() = 'libya_doctor' AND app_created_patient(patient_id));

CREATE POLICY cases_referring_insert ON cases_cases FOR INSERT
  WITH CHECK (app_current_role() = 'libya_doctor' AND app_created_patient(patient_id));

CREATE POLICY cases_referring_update ON cases_cases FOR UPDATE
  USING (app_current_role() = 'libya_doctor' AND app_created_patient(patient_id))
  WITH CHECK (app_created_patient(patient_id));

-- An assistant works the practice's calendar-less worklist: they may read the
-- cases of the organisation they are seated in, and change nothing.
CREATE POLICY cases_assistant ON cases_cases FOR SELECT
  USING (app_current_role() = 'assistant' AND app_member_of(organisation_id));

CREATE POLICY cases_admin ON cases_cases FOR SELECT
  USING (app_current_role() = 'admin');

CREATE POLICY cases_admin_update ON cases_cases FOR UPDATE
  USING (app_current_role() = 'admin') WITH CHECK (app_current_role() = 'admin');

CREATE POLICY case_studies_visible ON cases_case_studies FOR SELECT
  USING (app_can_see_case(case_id) AND app_can_see_study(study_id));

CREATE POLICY case_studies_insert ON cases_case_studies FOR INSERT
  WITH CHECK (app_current_role() = 'libya_doctor' AND app_can_see_study(study_id));

-- The assistant's agenda. It selected starts_at/ends_at/kind and ordered by
-- the appointment time; none of those columns exist now. The RETURNS TABLE
-- signature changes, so this is a DROP rather than a REPLACE.
--
-- A receptionist's worklist is now "cases in front of my doctors, newest
-- first". The window parameters are kept and applied to created_at: the call
-- sites pass them, and a function that silently ignored its arguments would be
-- worse than one that no longer takes them.
DROP FUNCTION IF EXISTS scheduling_assistant_agenda(timestamptz, timestamptz);

CREATE FUNCTION scheduling_assistant_agenda(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  id            uuid,
  doctor_id     uuid,
  doctor_name   text,
  patient_id    uuid,
  patient_name  text,
  patient_phone text,
  status        text,
  specialty     text,
  reason        text,
  notes         text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT a.id, a.doctor_id, d.full_name, a.patient_id, p.full_name, p.phone_e164,
         a.status, a.specialty, a.reason, a.notes
  FROM cases_cases a
  -- LEFT: a submitted case has no doctor yet, and an inner join would hide it
  -- from the very worklist that exists to chase it.
  LEFT JOIN identity_users d ON d.id = a.doctor_id
  JOIN patients_patients p ON p.id = a.patient_id
  WHERE app_current_role() = 'assistant'
    AND app_assists_doctor(a.doctor_id)
    AND (p_from IS NULL OR a.created_at >= p_from)
    AND (p_to IS NULL OR a.created_at < p_to)
  ORDER BY a.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION scheduling_assistant_agenda(timestamptz, timestamptz) TO mir_app;

-- Two policies OUTSIDE this module still call the old predicates by name, and
-- PostgreSQL tracks that dependency: dropping the functions without recreating
-- these first fails with "other objects depend on it". Both keep their exact
-- meaning; only the predicate they call is renamed.
DROP POLICY IF EXISTS patients_receiving_doctor ON patients_patients;
CREATE POLICY patients_receiving_doctor ON patients_patients FOR SELECT
  USING (
    app_current_role() = 'tunisia_doctor'
    AND app_has_case_with(id)
    AND app_has_consent_for(id)
  );

DROP POLICY IF EXISTS studies_receiving_doctor ON imaging_studies;
CREATE POLICY studies_receiving_doctor ON imaging_studies FOR SELECT
  USING (
    app_current_role() = 'tunisia_doctor'
    AND app_study_linked_to_my_case(id)
    AND app_has_consent_for(patient_id)
  );

-- Dropped last: the policies above referenced them until a moment ago.
DROP FUNCTION IF EXISTS app_has_appointment_with(uuid);
DROP FUNCTION IF EXISTS app_study_linked_to_my_appointment(uuid);
DROP FUNCTION IF EXISTS app_can_see_appointment(uuid);
DROP FUNCTION IF EXISTS app_triage_before_payment();

GRANT EXECUTE ON FUNCTION
  app_has_case_with(uuid), app_study_linked_to_my_case(uuid),
  app_can_see_case(uuid), app_can_see_study(uuid),
  billing_owing_organisation(uuid, text)
TO mir_app;

COMMIT;
