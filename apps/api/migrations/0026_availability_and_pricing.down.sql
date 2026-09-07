BEGIN;
DROP FUNCTION IF EXISTS pricing_accepting_count(text, text);
DROP FUNCTION IF EXISTS pricing_tier_bp(uuid);
ALTER TABLE identity_doctor_profiles
  DROP CONSTRAINT IF EXISTS identity_doctor_profiles_tier_fk;
ALTER TABLE identity_doctor_profiles
  DROP COLUMN IF EXISTS accepting_cases,
  DROP COLUMN IF EXISTS tier_code;
DROP TABLE IF EXISTS pricing_specialty_rates;
DROP TABLE IF EXISTS pricing_tiers;
COMMIT;
