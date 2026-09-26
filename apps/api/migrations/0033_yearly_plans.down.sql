BEGIN;

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
  ORDER BY p.side, p.sort;
$$;

GRANT EXECUTE ON FUNCTION billing_public_plans() TO mir_app;

-- Subscriptions on the yearly plans fall back to the monthly tier they replaced.
UPDATE billing_subscriptions SET plan_code = 'src_clinic' WHERE plan_code = 'src_clinic_yearly';
UPDATE billing_subscriptions SET plan_code = 'dst_clinic' WHERE plan_code = 'dst_doctor_yearly';
DELETE FROM billing_plans WHERE code IN ('src_clinic_yearly', 'dst_doctor_yearly');
UPDATE billing_plans SET active = true, updated_at = now();

ALTER TABLE billing_plans DROP CONSTRAINT billing_plans_code_check;
ALTER TABLE billing_plans ADD CONSTRAINT billing_plans_code_check
  CHECK (code IN ('src_solo','src_clinic','src_network',
                  'dst_solo','dst_clinic','dst_network'));

ALTER TABLE billing_plans DROP COLUMN billing_interval;

COMMIT;
