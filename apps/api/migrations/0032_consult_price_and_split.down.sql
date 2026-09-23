BEGIN;

DROP INDEX IF EXISTS billing_ledger_one_payout_per_case;
DELETE FROM billing_ledger_entries WHERE kind = 'doctor_payout';

ALTER TABLE billing_ledger_entries DROP CONSTRAINT ledger_entry_case_matches_kind;
ALTER TABLE billing_ledger_entries ADD CONSTRAINT ledger_fee_has_appointment CHECK (
  (kind = 'coordination_fee' AND case_id IS NOT NULL)
  OR (kind = 'saas_subscription' AND case_id IS NULL)
);
ALTER TABLE billing_ledger_entries DROP CONSTRAINT billing_ledger_entries_kind_check;
ALTER TABLE billing_ledger_entries ADD CONSTRAINT billing_ledger_entries_kind_check
  CHECK (kind IN ('coordination_fee', 'saas_subscription'));

ALTER TABLE cases_cases DROP COLUMN clinic_share_minor, DROP COLUMN doctor_share_minor;

DROP TABLE pricing_consult_price;

COMMIT;
