-- A flat consult price with a three-way split — spec 2026-09-21 §3.
--
--   $100 consult · the Libyan clinic keeps $30 · it remits $70 to the platform
--   · the platform pays the Tunisian doctor $20 · the platform keeps $50.
--
-- WHY A TABLE AND NOT CONSTANTS. The same reason the old rate card was one:
-- changing the price is an UPDATE, not a deploy.
--
-- WHY THE PLATFORM SHARE IS NOT A COLUMN. It is the remainder. Storing it
-- would allow a row whose three shares disagree with its price.
--
-- WHY THE SHARES ARE COPIED ONTO THE CASE. A quote is fixed once given (the
-- consult model's rule for the amount). Payment and answer read the CASE, so
-- a price edited after a clinic was quoted never changes what that case
-- owes or pays.
--
-- The specialty rate card, the seniority tiers and the surge ladder stay in
-- the schema; the code stops reading them. Dropping them would be a
-- destructive migration for a pricing decision that may yet be revisited.

BEGIN;

CREATE TABLE pricing_consult_price (
  corridor_id        text PRIMARY KEY,
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  currency           text   NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  clinic_share_minor bigint NOT NULL CHECK (clinic_share_minor >= 0),
  doctor_share_minor bigint NOT NULL CHECK (doctor_share_minor >= 0),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_consult_shares_fit CHECK (clinic_share_minor + doctor_share_minor <= amount_minor)
);

INSERT INTO pricing_consult_price (corridor_id, amount_minor, currency, clinic_share_minor, doctor_share_minor)
VALUES ('ly-tn', 10000, 'USD', 3000, 2000);

ALTER TABLE pricing_consult_price ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_consult_price FORCE  ROW LEVEL SECURITY;
-- Not patient data: every authenticated role may read what a consult costs;
-- only ops may change it.
CREATE POLICY consult_price_readable ON pricing_consult_price FOR SELECT
  USING (app_current_role() IS NOT NULL);
CREATE POLICY consult_price_ops_write ON pricing_consult_price FOR ALL
  USING (app_current_role() = 'admin') WITH CHECK (app_current_role() = 'admin');
GRANT SELECT, INSERT, UPDATE ON pricing_consult_price TO mir_app;

-- The split, locked at quote next to the amount.
ALTER TABLE cases_cases
  ADD COLUMN clinic_share_minor bigint CHECK (clinic_share_minor >= 0),
  ADD COLUMN doctor_share_minor bigint CHECK (doctor_share_minor >= 0);

-- What the platform owes a receiving doctor for an answered case.
ALTER TABLE billing_ledger_entries DROP CONSTRAINT billing_ledger_entries_kind_check;
ALTER TABLE billing_ledger_entries ADD CONSTRAINT billing_ledger_entries_kind_check
  CHECK (kind IN ('coordination_fee', 'saas_subscription', 'doctor_payout'));

ALTER TABLE billing_ledger_entries DROP CONSTRAINT ledger_fee_has_appointment;
ALTER TABLE billing_ledger_entries ADD CONSTRAINT ledger_entry_case_matches_kind CHECK (
  (kind IN ('coordination_fee', 'doctor_payout') AND case_id IS NOT NULL)
  OR (kind = 'saas_subscription' AND case_id IS NULL)
);

-- One payout per case, whatever retries the answer path goes through.
CREATE UNIQUE INDEX billing_ledger_one_payout_per_case
  ON billing_ledger_entries (case_id)
  WHERE kind = 'doctor_payout';

COMMIT;
