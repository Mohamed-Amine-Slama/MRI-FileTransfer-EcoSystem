-- Restores identity_decide_verification as it was before 0031 (no profile on approval).
-- The lowercase specialty normalisation is not reversed: the original spellings are not recorded.

BEGIN;

CREATE OR REPLACE FUNCTION public.identity_decide_verification(p_org uuid, p_approve boolean, p_reason_key text, p_granted_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := app_current_user_id();
BEGIN
  IF app_current_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only platform staff may decide a verification'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_approve AND p_granted_role NOT IN ('libya_doctor','tunisia_doctor') THEN
    -- Belt and braces alongside the derivation in the service: 'admin' and
    -- 'patient' are not grantable by this route at any cost.
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
    -- Already decided, or no such organisation. Re-deciding would silently
    -- move an approved provider back to pending and revoke access nobody asked
    -- to revoke.
    RAISE EXCEPTION 'no pending organisation with that id' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_approve THEN
    -- Every seated member gains the role. A rejection grants nothing and takes
    -- nothing away — the account simply stays an applicant.
    UPDATE identity_users
    SET role = p_granted_role, status = 'active'
    WHERE id IN (SELECT user_id FROM identity_memberships WHERE organisation_id = p_org)
      AND role = 'applicant';
  END IF;
END;
$function$

;

COMMIT;
