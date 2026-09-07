-- Availability collapses to one boolean, and the platform gets a rate card.
--
-- WHY DEFAULT FALSE. It matches how `applicant` works: the fail-closed
-- direction. An approved doctor appears in no lab's directory until they say
-- they are open for work. Defaulting true would enrol every doctor into
-- receiving cases at the moment ops approves them, which is a decision that
-- belongs to the doctor and not to an ops reviewer.
--
-- WHY THESE ARE TABLES AND NOT CONSTANTS. The same reason `billing_fee_schedule`
-- is a table (0023): the agreed rate is rows, not a branch in code. Changing
-- radiology's price is an UPDATE, not a deploy.
--
-- WHY BASIS POINTS. Money is integer minor units everywhere in this schema. A
-- numeric multiplier would reintroduce exactly the rounding that convention
-- exists to prevent, and the drift would land in the doctor's payout.

BEGIN;

ALTER TABLE identity_doctor_profiles
  ADD COLUMN accepting_cases boolean NOT NULL DEFAULT false,
  ADD COLUMN tier_code       text    NOT NULL DEFAULT 'standard';

CREATE TABLE pricing_tiers (
  code          text PRIMARY KEY,
  multiplier_bp int  NOT NULL CHECK (multiplier_bp > 0),
  min_answered  int  NOT NULL CHECK (min_answered >= 0),
  sort          int  NOT NULL
);

INSERT INTO pricing_tiers (code, multiplier_bp, min_answered, sort) VALUES
  ('standard', 10000,   0, 0),
  ('senior',   12000,  50, 1),
  ('expert',   14000, 200, 2);

ALTER TABLE identity_doctor_profiles
  ADD CONSTRAINT identity_doctor_profiles_tier_fk
  FOREIGN KEY (tier_code) REFERENCES pricing_tiers(code);

CREATE TABLE pricing_specialty_rates (
  corridor_id  text   NOT NULL,
  specialty    text   NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency     text   NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  active       boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (corridor_id, specialty)
);

-- Seeded in USD, matching the corridor's declared currencies. These are
-- placeholders for a commercial decision, not an agreed price list.
INSERT INTO pricing_specialty_rates (corridor_id, specialty, amount_minor, currency) VALUES
  ('ly-tn', 'radiology',   4000, 'USD'),
  ('ly-tn', 'cardiology',  5500, 'USD'),
  ('ly-tn', 'neurology',   6000, 'USD'),
  ('ly-tn', 'oncology',    6500, 'USD'),
  -- Cases carried over from the booking model have no stated specialty. They
  -- are priced at the base rate rather than being unpriceable.
  ('ly-tn', 'unspecified', 4000, 'USD');

ALTER TABLE pricing_tiers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_tiers           FORCE  ROW LEVEL SECURITY;
ALTER TABLE pricing_specialty_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_specialty_rates FORCE  ROW LEVEL SECURITY;

-- The rate card is not patient data. Every authenticated role may read it — a
-- lab must see what a case costs before it commits — and nobody but ops may
-- write it.
CREATE POLICY pricing_tiers_readable ON pricing_tiers FOR SELECT
  USING (app_current_role() IS NOT NULL);
CREATE POLICY pricing_rates_readable ON pricing_specialty_rates FOR SELECT
  USING (app_current_role() IS NOT NULL);
CREATE POLICY pricing_rates_ops_write ON pricing_specialty_rates FOR ALL
  USING (app_current_role() = 'admin') WITH CHECK (app_current_role() = 'admin');

GRANT SELECT ON pricing_tiers TO mir_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pricing_specialty_rates TO mir_app;

-- ---------------------------------------------------------------------------
-- Surge needs a headcount, and the lab asking for it cannot see the doctors.
--
-- A referring doctor has no policy granting SELECT on identity_doctor_profiles
-- or identity_memberships, and rightly so. But the price they are quoted
-- depends on how many doctors are accepting, so the count comes through a
-- narrow definer function that returns a NUMBER and never a row. That is the
-- whole surface: no names, no ids, no way to enumerate who is online.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pricing_accepting_count(p_corridor text, p_specialty text)
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

-- The tier multiplier for one doctor, for the same reason.
CREATE FUNCTION pricing_tier_bp(p_doctor uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT t.multiplier_bp
    FROM identity_doctor_profiles dp
    JOIN pricing_tiers t ON t.code = dp.tier_code
   WHERE dp.user_id = p_doctor;
$$;

GRANT EXECUTE ON FUNCTION
  pricing_accepting_count(text, text), pricing_tier_bp(uuid)
TO mir_app;

COMMIT;
