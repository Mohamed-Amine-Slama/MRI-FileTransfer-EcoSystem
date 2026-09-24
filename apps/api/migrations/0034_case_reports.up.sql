-- The structured consult report — spec 2026-09-21 §5.
-- One row per case. The doctor drafts it while the case is `accepted`; it is
-- submitted in the same transaction that answers the case, and from then on it
-- is read-only for everybody.
BEGIN;

CREATE TABLE cases_reports (
  case_id      uuid PRIMARY KEY REFERENCES cases_cases(id) ON DELETE CASCADE,
  author_id    uuid NOT NULL REFERENCES identity_users(id),
  content      jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  -- Belt and braces on the API's 64 KB cap: a draft is not file storage.
  CONSTRAINT reports_content_bounded CHECK (pg_column_size(content) < 131072),
  CONSTRAINT reports_submitted_stamped CHECK ((status = 'submitted') = (submitted_at IS NOT NULL))
);

ALTER TABLE cases_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases_reports FORCE  ROW LEVEL SECURITY;

-- The author, on their own case. Writes only while the case is accepted and
-- the row is still a draft; the subquery reads cases_cases under the doctor's
-- own policy, so "their case" is the database's answer, not the service's.
CREATE POLICY reports_doctor_select ON cases_reports FOR SELECT
  USING (app_current_role() = 'tunisia_doctor' AND author_id = app_current_user_id());
CREATE POLICY reports_doctor_insert ON cases_reports FOR INSERT
  WITH CHECK (
    app_current_role() = 'tunisia_doctor' AND author_id = app_current_user_id() AND status = 'draft'
    AND EXISTS (SELECT 1 FROM cases_cases c
                 WHERE c.id = case_id AND c.doctor_id = app_current_user_id() AND c.status = 'accepted'));
CREATE POLICY reports_doctor_update ON cases_reports FOR UPDATE
  USING (app_current_role() = 'tunisia_doctor' AND author_id = app_current_user_id() AND status = 'draft')
  WITH CHECK (
    author_id = app_current_user_id()
    AND EXISTS (SELECT 1 FROM cases_cases c
                 WHERE c.id = case_id AND c.doctor_id = app_current_user_id() AND c.status = 'accepted'));

-- The referring clinic reads the report once it is submitted, never a draft.
CREATE POLICY reports_referring_select ON cases_reports FOR SELECT
  USING (app_current_role() = 'libya_doctor' AND status = 'submitted' AND app_can_see_case(case_id));

CREATE POLICY reports_admin_select ON cases_reports FOR SELECT
  USING (app_current_role() = 'admin');

GRANT SELECT, INSERT, UPDATE ON cases_reports TO mir_app;

COMMIT;
