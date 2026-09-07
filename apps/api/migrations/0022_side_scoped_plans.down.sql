-- Local rollback only.
--
-- Subscriptions deleted by the up migration are NOT restored, and neither are
-- any written since: a subscription on 'src_clinic' has no flat-catalogue
-- equivalent, and inventing one would put a clinic on a tier it never chose.

BEGIN;

DROP TRIGGER IF EXISTS billing_subscriptions_side_match ON billing_subscriptions;
DROP FUNCTION IF EXISTS billing_subscription_side_matches();

DELETE FROM billing_subscriptions;
DELETE FROM billing_plans;

ALTER TABLE billing_plans DROP CONSTRAINT IF EXISTS billing_plans_code_matches_side;
ALTER TABLE billing_plans DROP CONSTRAINT IF EXISTS billing_plans_side_check;
ALTER TABLE billing_plans DROP COLUMN side;

ALTER TABLE billing_plans DROP CONSTRAINT IF EXISTS billing_plans_code_check;
ALTER TABLE billing_plans ADD CONSTRAINT billing_plans_code_check
  CHECK (code IN ('solo','clinic','network'));

INSERT INTO billing_plans (code, price_minor, currency, seat_limit, monthly_case_limit, entitlements, sort)
VALUES
  ('solo',      4900, 'USD',    1,   10, ARRAY['csvExport'], 0),
  ('clinic',   19900, 'USD',   10,  100, ARRAY['csvExport','prioritySupport','auditTrailRetention'], 1),
  ('network',   NULL,  NULL, NULL, NULL,
     ARRAY['csvExport','prioritySupport','auditTrailRetention','multiCorridor','dedicatedOnboarding'], 2);

DROP FUNCTION IF EXISTS billing_public_plans();

CREATE FUNCTION billing_public_plans()
RETURNS TABLE (
  code text, price_minor bigint, currency text, seat_limit integer,
  monthly_case_limit integer, entitlements text[], sort integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.code, p.price_minor, p.currency, p.seat_limit, p.monthly_case_limit,
         p.entitlements, p.sort
  FROM billing_plans p WHERE p.active ORDER BY p.sort;
$$;

GRANT EXECUTE ON FUNCTION billing_public_plans() TO mir_app;

COMMIT;
