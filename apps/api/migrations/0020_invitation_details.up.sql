-- Reading an invitation's details before redeeming it.
--
-- THE PROBLEM. The specialty a hospital states lives on the invitation row, and
-- the person who needs it applied to their profile is the INVITEE — who matches
-- no SELECT policy on `identity_invitations`. `invitations_owner` is the
-- organisation's owner and `invitations_clinician_own` (0018) is the clinician
-- who sent it; neither is the recipient. And after
-- `identity_accept_invitation` runs, the row is consumed, so reading it
-- afterwards is not an option either.
--
-- So: a definer function the service calls with the token hash it already
-- holds, BEFORE redeeming. It returns only what provisioning needs.
--
-- WHY THE TOKEN HASH IS THE AUTHORISATION. Holding the token is what makes
-- someone the invitee — that is already true of `identity_accept_invitation`,
-- which redeems on the same evidence. This returns strictly less than that
-- function grants, and it cannot be used to enumerate: the hash is SHA-256 of a
-- 32-byte random token, so guessing one is the same problem as forging an
-- acceptance.
--
-- It deliberately does NOT return the email or the inviter. Neither is needed to
-- apply a specialty, and an unconsumed-invitation lookup that answers "who was
-- this addressed to" is a lookup worth not having.

BEGIN;

CREATE OR REPLACE FUNCTION identity_invitation_details(p_token_hash text)
RETURNS TABLE (organisation_id uuid, seat_role text, specialty text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT i.organisation_id, i.seat_role, i.specialty
  FROM identity_invitations i
  WHERE i.token_hash = p_token_hash
    AND i.consumed_at IS NULL
    AND i.expires_at > now();
$$;

GRANT EXECUTE ON FUNCTION identity_invitation_details(text) TO mir_app;

COMMIT;
