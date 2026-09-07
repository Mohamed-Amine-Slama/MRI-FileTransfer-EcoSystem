-- The directory the lab browses, and the switch the doctor flips.
--
-- WHY BOTH ARE FUNCTIONS. `identity_doctor_profiles` has exactly two SELECT
-- policies (0002): the doctor themselves, and admin. A referring lab matches
-- neither, so the directory query that joins that table returns zero rows —
-- silently, because RLS filters rather than errors. The fix is NOT a broad
-- SELECT policy: that would expose every profile column (licence number,
-- verification state) to every authenticated caller in order to publish a
-- name and a specialty. A definer function with an explicit RETURNS TABLE
-- publishes precisely the directory columns and nothing else, which is the
-- same reasoning as `scheduling_assistant_agenda` (0015) and
-- `pricing_accepting_count` (0026).
--
-- WHY THE COUNT IS REDEFINED HERE. `pricing_accepting_count` filtered on the
-- organisation's approval but not on `verified_at`, while the directory must
-- filter on both — a doctor whose verified_at is null cannot receive imaging
-- (DECISION: Chapter V restricted transfer). Left as it was, surge would be
-- computed over a larger pool than the lab can actually pick from, so a
-- specialty could quote a crowded-market price with nobody selectable in it.
-- The count and the directory must be the same set or the price is a fiction.

BEGIN;

CREATE OR REPLACE FUNCTION pricing_accepting_count(p_corridor text, p_specialty text)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT count(DISTINCT dp.user_id)::int
    FROM identity_doctor_profiles dp
    JOIN identity_users u           ON u.id = dp.user_id
    JOIN identity_memberships m     ON m.user_id = dp.user_id
    JOIN identity_organisations o   ON o.id = m.organisation_id
   WHERE dp.accepting_cases
     AND dp.specialty  = p_specialty
     AND dp.verified_at IS NOT NULL
     AND u.role   = 'tunisia_doctor'
     AND u.status = 'active'
     AND o.corridor_id = p_corridor
     AND o.side        = 'destination'
     AND o.verification_status = 'approved';
$$;

-- ---------------------------------------------------------------------------
-- The directory.
--
-- Returns only doctors who are ACCEPTING. There is deliberately no way to ask
-- this function for the ones who are not: who has switched off, and when, is
-- the doctor's own working pattern and not something a lab may enumerate.
--
-- `multiplier_bp` travels with the row so the web app can show an indicative
-- price without a second round trip per doctor. It is indicative only — the
-- number that binds is the one `POST /cases/:id/quote` locks.
-- ---------------------------------------------------------------------------
CREATE FUNCTION cases_doctor_directory(p_corridor text, p_specialty text)
RETURNS TABLE (
  id            uuid,
  display_name  text,
  specialty     text,
  clinic_name   text,
  tier_code     text,
  multiplier_bp int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT
         u.id,
         u.full_name,
         dp.specialty,
         dp.clinic_name,
         dp.tier_code,
         t.multiplier_bp
    FROM identity_doctor_profiles dp
    JOIN identity_users u           ON u.id = dp.user_id
    JOIN pricing_tiers t            ON t.code = dp.tier_code
    JOIN identity_memberships m     ON m.user_id = dp.user_id
    JOIN identity_organisations o   ON o.id = m.organisation_id
   WHERE dp.accepting_cases
     AND dp.verified_at IS NOT NULL
     AND (p_specialty IS NULL OR dp.specialty = p_specialty)
     AND u.role   = 'tunisia_doctor'
     AND u.status = 'active'
     AND o.corridor_id = p_corridor
     AND o.side        = 'destination'
     AND o.verification_status = 'approved'
   ORDER BY u.full_name;
$$;

-- ---------------------------------------------------------------------------
-- The switch.
--
-- WHY A FUNCTION AND NOT AN UPDATE POLICY. An RLS policy governs which ROWS a
-- caller may update, never which COLUMNS. A `doctor_profiles_self_update`
-- policy would let a doctor rewrite their own licence number, specialty and
-- `verified_at` — the last of which is the safeguard that decides whether
-- imaging may be routed to them at all. This function writes one boolean.
--
-- It takes no user id: the row is chosen from the session context, so there is
-- no parameter with which to switch someone else on.
-- ---------------------------------------------------------------------------
CREATE FUNCTION cases_set_accepting(p_accepting boolean)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed int;
BEGIN
  IF app_current_role() <> 'tunisia_doctor' THEN
    RAISE EXCEPTION 'Only a receiving doctor has an availability switch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE identity_doctor_profiles
     SET accepting_cases = p_accepting
   WHERE user_id = app_current_user_id();

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END;
$$;

-- ---------------------------------------------------------------------------
-- Is this one doctor accepting, right now?
--
-- The directory answers "who can take this", which is the wrong question at
-- the moment of quoting: the lab is holding a page that was rendered seconds
-- or minutes ago. This answers the narrow question the write needs, and it
-- returns a BOOLEAN so it can sit in the UPDATE's WHERE clause — the check and
-- the write then happen in one statement, and a doctor switching off in
-- between cannot be handed the case anyway.
-- ---------------------------------------------------------------------------
CREATE FUNCTION cases_doctor_accepting(p_doctor uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM identity_doctor_profiles dp
      JOIN identity_users u         ON u.id = dp.user_id
      JOIN identity_memberships m   ON m.user_id = dp.user_id
      JOIN identity_organisations o ON o.id = m.organisation_id
     WHERE dp.user_id = p_doctor
       AND dp.accepting_cases
       AND dp.verified_at IS NOT NULL
       AND u.role   = 'tunisia_doctor'
       AND u.status = 'active'
       AND o.side   = 'destination'
       AND o.verification_status = 'approved'
  );
$$;

GRANT EXECUTE ON FUNCTION
  cases_doctor_directory(text, text),
  cases_doctor_accepting(uuid),
  cases_set_accepting(boolean)
TO mir_app;

COMMIT;
