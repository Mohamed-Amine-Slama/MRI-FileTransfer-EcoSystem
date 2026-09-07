BEGIN;

DROP FUNCTION IF EXISTS cases_set_accepting(boolean);
DROP FUNCTION IF EXISTS cases_doctor_accepting(uuid);
DROP FUNCTION IF EXISTS cases_doctor_directory(text, text);

-- Restore 0026's body, which counted on organisation approval alone.
CREATE OR REPLACE FUNCTION pricing_accepting_count(p_corridor text, p_specialty text)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT count(DISTINCT dp.user_id)::int
    FROM identity_doctor_profiles dp
    JOIN identity_memberships m     ON m.user_id = dp.user_id
    JOIN identity_organisations o   ON o.id = m.organisation_id
   WHERE dp.accepting_cases
     AND dp.specialty  = p_specialty
     AND o.corridor_id = p_corridor
     AND o.side        = 'destination'
     AND o.verification_status = 'approved';
$$;

COMMIT;
