-- Two yearly plans — spec 2026-09-21 §4.
--
-- The owner's terms: a Libyan clinic pays 1000 USD a year, a Tunisian doctor
-- 1000 TND a year. They replace the six monthly placeholder tiers.
--
-- The old tiers are DEACTIVATED, never deleted: billing_subscriptions.plan_code
-- references them, and a subscription on a retired tier still has to render.
-- billing_public_plans() already filters on `active`, so /pricing shows only
-- the two new plans.
--
-- Amounts are minor units. TND has THREE decimals, so 1000 dinars is 1000000.

BEGIN;

ALTER TABLE billing_plans
  ADD COLUMN billing_interval text NOT NULL DEFAULT 'month'
    CHECK (billing_interval IN ('month', 'year'));

ALTER TABLE billing_plans DROP CONSTRAINT billing_plans_code_check;
ALTER TABLE billing_plans ADD CONSTRAINT billing_plans_code_check
  CHECK (code IN ('src_solo','src_clinic','src_network',
                  'dst_solo','dst_clinic','dst_network',
                  'src_clinic_yearly','dst_doctor_yearly'));

UPDATE billing_plans SET active = false, updated_at = now();

-- Limits are NULL (unlimited): the owner set a price, not a cap, and a cap
-- nobody agreed to would refuse real clinical work.
INSERT INTO billing_plans
  (code, side, price_minor, currency, billing_interval, seat_limit, monthly_case_limit,
   entitlements, sort)
VALUES
  ('src_clinic_yearly', 'source',       100000, 'USD', 'year', NULL, NULL,
     ARRAY['csvExport','prioritySupport','auditTrailRetention'], 0),
  ('dst_doctor_yearly', 'destination', 1000000, 'TND', 'year', NULL, NULL,
     ARRAY['csvExport','prioritySupport','auditTrailRetention'], 0);

-- Dropped and recreated: the return type gains a column.
DROP FUNCTION IF EXISTS billing_public_plans();

CREATE FUNCTION billing_public_plans()
RETURNS TABLE (
  code text,
  side text,
  price_minor bigint,
  currency text,
  billing_interval text,
  seat_limit integer,
  monthly_case_limit integer,
  entitlements text[],
  sort integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.code, p.side, p.price_minor, p.currency, p.billing_interval, p.seat_limit,
         p.monthly_case_limit, p.entitlements, p.sort
  FROM billing_plans p
  WHERE p.active
  ORDER BY p.side, p.sort;
$$;

GRANT EXECUTE ON FUNCTION billing_public_plans() TO mir_app;

COMMIT;
