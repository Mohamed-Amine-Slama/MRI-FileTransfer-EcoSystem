-- Approving a Tunisian doctor opens their door — spec 2026-09-21 §7.
--
-- WHAT WAS BROKEN. identity_decide_verification granted `tunisia_doctor` but
-- created no identity_doctor_profiles row. The availability switch
-- (cases_set_accepting) updates that row, so for every doctor ops approved it
-- changed nothing and the API answered 404: "the switch is broken". And the
-- directory, the quote check and the headcount all require `verified_at`, so
-- even a hand-made profile left the doctor invisible to every clinic.
--
-- WHAT APPROVAL NOW DOES. For a destination approval it upserts a profile for
-- each seated member, VERIFIED at the decision (the decision IS the
-- verification — that is what ops just did), with the licence number and the
-- specialty the doctor gave at sign-up. The specialty is stored as a lowercase
-- key: profiles said `Radiology` while cases and rates said `radiology`, and
-- the directory compares them exactly.
--
-- `unspecified` rather than NULL when sign-up predates the specialty field: the
-- column is NOT NULL, and a doctor with no specialty should still be able to
-- sign in and switch on; they simply match no specialty filter until ops sets
-- one.

BEGIN;

CREATE OR REPLACE FUNCTION identity_decide_verification(
  p_org uuid, p_approve boolean, p_reason_key text, p_granted_role text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := app_current_user_id();
BEGIN
  IF app_current_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only platform staff may decide a verification'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_approve AND p_granted_role NOT IN ('libya_doctor','tunisia_doctor') THEN
    RAISE EXCEPTION 'a verification may only grant a corridor endpoint role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE identity_organisations
  SET verification_status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      decided_at = now(),
      decided_by = v_actor,
      reason_key = p_reason_key
  WHERE id = p_org AND verification_status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no pending organisation with that id' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_approve THEN
    UPDATE identity_users
    SET role = p_granted_role, status = 'active'
    WHERE id IN (SELECT user_id FROM identity_memberships WHERE organisation_id = p_org)
      AND role = 'applicant';

    IF p_granted_role = 'tunisia_doctor' THEN
      INSERT INTO identity_doctor_profiles
        (user_id, country, license_number, specialty, clinic_name, verified_at, verified_by)
      SELECT m.user_id, 'TN',
             COALESCE(NULLIF(o.credentials->>'cnomNumber', ''), 'UNSET-' || left(m.user_id::text, 8)),
             COALESCE(NULLIF(lower(o.credentials->>'specialty'), ''), 'unspecified'),
             o.legal_name, now(), v_actor
        FROM identity_memberships m
        JOIN identity_organisations o ON o.id = m.organisation_id
       WHERE m.organisation_id = p_org
         AND m.seat_role <> 'assistant'
      ON CONFLICT (user_id) DO UPDATE
         SET verified_at = COALESCE(identity_doctor_profiles.verified_at, EXCLUDED.verified_at),
             verified_by = COALESCE(identity_doctor_profiles.verified_by, EXCLUDED.verified_by),
             specialty   = lower(identity_doctor_profiles.specialty);
    END IF;
  END IF;
END;
$$;

-- Existing rows: one spelling of every specialty.
UPDATE identity_doctor_profiles SET specialty = lower(specialty) WHERE specialty <> lower(specialty);
UPDATE identity_memberships SET specialty = lower(specialty)
 WHERE specialty IS NOT NULL AND specialty <> lower(specialty);
UPDATE cases_cases SET specialty = lower(specialty) WHERE specialty <> lower(specialty);

COMMIT;
