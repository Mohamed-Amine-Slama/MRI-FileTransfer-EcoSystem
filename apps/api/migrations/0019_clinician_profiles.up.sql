-- What a hospital may say about the clinicians working under it.
--
-- THE SPECIALTY GOES ON THE MEMBERSHIP, NOT ON THE DOCTOR PROFILE, and the
-- reason is worth stating because the profile is the obvious place and it is
-- wrong.
--
-- `identity_doctor_profiles` is a LICENSURE record: `license_number` and
-- `specialty` are both NOT NULL, and `verified_at` is what ops sets once the
-- paperwork has been checked. A hospital saying "she practises radiology here"
-- is an employment fact, not a licence assertion — it cannot supply a licence
-- number and must not be asked to invent one. Writing that statement into the
-- licensure table would either require relaxing NOT NULL (so that a row can
-- claim a licence it does not have) or fabricating a placeholder. Both make the
-- table mean less than it does today.
--
-- A membership already says "this person works at this organisation". Adding
-- the specialty there says "…as a radiologist", which is exactly the claim a
-- hospital is entitled to make, scoped to the place it is true. A clinician
-- reading for two hospitals in different departments is then representable,
-- which a single column on the user is not.
--
-- Appointment routing reads the membership first and falls back to the
-- verified profile, so a doctor whose licensure record already names a
-- specialty needs nothing restated.

BEGIN;

ALTER TABLE identity_memberships
  ADD COLUMN specialty text;

COMMENT ON COLUMN identity_memberships.specialty IS
  'What this person practises AT THIS ORGANISATION. An employment fact stated by '
  'the organisation, never a licensure claim — that is identity_doctor_profiles, '
  'which requires a licence number and an ops verification.';

-- ---------------------------------------------------------------------------
-- Recording it.
--
-- SECURITY DEFINER because the invitee applies it to their OWN membership at
-- acceptance, and `memberships_same_org` is SELECT-only — there is no UPDATE
-- policy on memberships at all, deliberately: seats are created by the
-- acceptance function and not edited from the application.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION identity_set_membership_specialty(
  p_org       uuid,
  p_user      uuid,
  p_specialty text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_specialty IS NULL OR btrim(p_specialty) = '' THEN
    RETURN;
  END IF;

  UPDATE identity_memberships
  SET specialty = btrim(p_specialty)
  WHERE organisation_id = p_org AND user_id = p_user;
END;
$$;

-- ---------------------------------------------------------------------------
-- The clinicians of one organisation, for assigning work to them.
--
-- Returns a NAME, a ROLE and a SPECIALTY. Not the licence number and not the
-- verification decision — neither is a colleague's business, and a policy on
-- `identity_doctor_profiles` would have handed over both.
--
-- Scoped to organisations the CALLER belongs to, so this is not a directory of
-- every clinician on the platform.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION identity_organisation_clinicians(p_org uuid)
RETURNS TABLE (user_id uuid, full_name text, role text, specialty text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.full_name, u.role, COALESCE(m.specialty, p.specialty)
  FROM identity_memberships m
  JOIN identity_users u ON u.id = m.user_id
  LEFT JOIN identity_doctor_profiles p ON p.user_id = u.id
  WHERE m.organisation_id = p_org
    AND app_member_of(p_org)
    AND u.role IN ('libya_doctor','tunisia_doctor')
    AND u.status = 'active'
  ORDER BY u.full_name;
$$;

GRANT EXECUTE ON FUNCTION identity_set_membership_specialty(uuid, uuid, text) TO mir_app;
GRANT EXECUTE ON FUNCTION identity_organisation_clinicians(uuid) TO mir_app;

COMMIT;
