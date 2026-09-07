-- Two catalogues, one per corridor side.
--
-- A source organisation SUBMITS cases; a destination organisation RECEIVES
-- them. Those are different products with different meters, and a single
-- `monthly_case_limit` that means "submitted" on one side and "accepted" on the
-- other is one name for two things — the ambiguity survives right up until
-- someone disputes an invoice.
--
-- `code` stays the single-column primary key — codes are namespaced instead —
-- so `billing_subscriptions.plan_code` and its foreign key are untouched.
--
-- ⚠ EVERY SEEDED PRICE AND LIMIT REMAINS A PLACEHOLDER, and the tier CONTENTS
-- are undecided, not merely the numbers. Nothing here is an offer, and nothing
-- here takes money: BLOCKING ITEM L7 is still unresolved, exactly as migrations
-- 0007 and 0011 record.

BEGIN;

ALTER TABLE billing_plans ADD COLUMN side text;

-- The old three codes are replaced wholesale rather than renamed, because a
-- subscription pointing at 'clinic' cannot be assigned to a side without
-- guessing which one its organisation is on. Guessing here would seat a clinic
-- on a tier nobody chose, which is worse than making them choose again.
DELETE FROM billing_subscriptions;
DELETE FROM billing_plans;

ALTER TABLE billing_plans
  ALTER COLUMN side SET NOT NULL,
  ADD CONSTRAINT billing_plans_side_check CHECK (side IN ('source','destination'));

ALTER TABLE billing_plans DROP CONSTRAINT IF EXISTS billing_plans_code_check;
ALTER TABLE billing_plans ADD CONSTRAINT billing_plans_code_check
  CHECK (code IN ('src_solo','src_clinic','src_network',
                  'dst_solo','dst_clinic','dst_network'));

-- The prefix and the column say the same thing on purpose: the prefix is what
-- keeps the primary key one column, and the column is what code filters on
-- without parsing a string. This CHECK is what stops them from disagreeing.
ALTER TABLE billing_plans ADD CONSTRAINT billing_plans_code_matches_side
  CHECK (
    (side = 'source'      AND code LIKE 'src\_%') OR
    (side = 'destination' AND code LIKE 'dst\_%')
  );

INSERT INTO billing_plans
  (code, side, price_minor, currency, seat_limit, monthly_case_limit, entitlements, sort)
VALUES
  ('src_solo',    'source',       4900, 'USD',    1,   10, ARRAY['csvExport'], 0),
  ('src_clinic',  'source',      19900, 'USD',   10,  100,
     ARRAY['csvExport','prioritySupport','auditTrailRetention'], 1),
  ('src_network', 'source',       NULL,  NULL, NULL, NULL,
     ARRAY['csvExport','prioritySupport','auditTrailRetention','multiCorridor','dedicatedOnboarding'], 2),
  ('dst_solo',    'destination',  4900, 'USD',    1,   10, ARRAY['csvExport'], 0),
  ('dst_clinic',  'destination', 19900, 'USD',   10,  100,
     ARRAY['csvExport','prioritySupport','auditTrailRetention'], 1),
  ('dst_network', 'destination',  NULL,  NULL, NULL, NULL,
     ARRAY['csvExport','prioritySupport','auditTrailRetention','multiCorridor','dedicatedOnboarding'], 2);

-- ---------------------------------------------------------------------------
-- An organisation may only subscribe to a plan on its own side.
--
-- A trigger rather than a CHECK because the rule spans two tables, and in the
-- database rather than the service because every other integrity rule in this
-- schema is. A service-only check is one forgotten call site away from a Libyan
-- clinic on a Tunisian tier, which is a billing dispute nobody can settle from
-- the data.
--
-- SQLSTATE 23514 (check_violation) so a caller that already maps constraint
-- violations to a 4xx keeps doing the right thing without learning a new code.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing_subscription_side_matches() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_side  text;
  v_plan_side text;
BEGIN
  SELECT side INTO v_org_side  FROM identity_organisations WHERE id   = NEW.organisation_id;
  SELECT side INTO v_plan_side FROM billing_plans          WHERE code = NEW.plan_code;

  IF v_org_side IS DISTINCT FROM v_plan_side THEN
    RAISE EXCEPTION
      'organisation is on the % side and cannot subscribe to a % plan',
      v_org_side, v_plan_side
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER billing_subscriptions_side_match
  BEFORE INSERT OR UPDATE ON billing_subscriptions
  FOR EACH ROW EXECUTE FUNCTION billing_subscription_side_matches();

-- ---------------------------------------------------------------------------
-- The public catalogue read now carries the side, so /pricing can show both
-- ladders and the settings screen can show the one the caller can buy.
--
-- Dropped and recreated rather than replaced: CREATE OR REPLACE cannot change
-- a function's return type, and this one gains a column.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS billing_public_plans();

CREATE FUNCTION billing_public_plans()
RETURNS TABLE (
  code text,
  side text,
  price_minor bigint,
  currency text,
  seat_limit integer,
  monthly_case_limit integer,
  entitlements text[],
  sort integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.code, p.side, p.price_minor, p.currency, p.seat_limit,
         p.monthly_case_limit, p.entitlements, p.sort
  FROM billing_plans p
  WHERE p.active
  -- `sort` is only unique WITHIN a side, so ordering by it alone interleaves
  -- the two ladders.
  ORDER BY p.side, p.sort;
$$;

GRANT EXECUTE ON FUNCTION billing_public_plans() TO mir_app;

COMMIT;
