-- The ledger's first real persistence, and the end of the patient's card.
--
-- ⚠ NOTHING HERE TAKES MONEY. Blocking item L7 is unresolved: whether a Libyan
-- payer can lawfully and practically pay a Tunisian-facing platform, and in
-- which jurisdiction the receiving entity must be incorporated. Migrations 0007
-- and 0011 make the same commitment. `status` is modelled so that wiring a rail
-- later is a service change rather than a migration against live entries.
--
-- THE TWO KINDS SHARE A TABLE AND MUST NEVER SHARE A TOTAL. §5.7 P0 forbids
-- merging coordination fees with subscription charges into one ambiguous
-- "amount owed". There is no total column here, and no view or endpoint may
-- produce one. Storing both kinds in one table is a storage decision, not
-- permission to sum them.

BEGIN;

-- ---------------------------------------------------------------------------
-- What each side owes per referral, per corridor.
--
-- A table rather than a constant: ops changes rates, and a rate change must not
-- be a deploy — the same reasoning that made the plan catalogue a table. A
-- 60/40 split is two rows, not a branch in code.
--
-- `corridor_id` is opaque text with no foreign key, matching
-- identity_organisations: corridors are application configuration
-- (lib/corridor/registry.ts), and a foreign key would move that into a
-- migration (§4.3).
-- ---------------------------------------------------------------------------
CREATE TABLE billing_fee_schedule (
  corridor_id   text NOT NULL,
  side          text NOT NULL CHECK (side IN ('source','destination')),
  amount_minor  bigint NOT NULL CHECK (amount_minor >= 0),
  currency      text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  active        boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (corridor_id, side)
);

-- ⚠ PLACEHOLDER RATES, like every other figure in this system. The SPLIT is
-- the decided part (both sides pay); the numbers are not.
INSERT INTO billing_fee_schedule (corridor_id, side, amount_minor, currency) VALUES
  ('ly-tn', 'source',      3000, 'USD'),
  ('ly-tn', 'destination', 2000, 'USD');

-- ---------------------------------------------------------------------------
-- What an organisation owes.
--
-- `appointment_id` and not `case_id`: `Case` is a contract-level concept with
-- no table (packages/contracts/src/case.ts), and the durable row both accrual
-- moments already turn on is the appointment — it carries the assignment, the
-- patient, its linked studies, and the status the accept/decline flow drives.
-- ---------------------------------------------------------------------------
CREATE TABLE billing_ledger_entries (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  organisation_id  uuid NOT NULL REFERENCES identity_organisations(id),
  kind             text NOT NULL CHECK (kind IN ('coordination_fee','saas_subscription')),
  appointment_id   uuid REFERENCES scheduling_appointments(id),
  amount_minor     bigint NOT NULL CHECK (amount_minor > 0),
  currency         text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','paid','overdue')),
  occurred_at      timestamptz NOT NULL DEFAULT now(),

  -- A subscription charge has no referral; a coordination fee must have one.
  -- This is also what stops the two kinds being told apart by convention
  -- rather than by the data.
  CONSTRAINT ledger_fee_has_appointment CHECK (
    (kind = 'coordination_fee' AND appointment_id IS NOT NULL)
    OR (kind = 'saas_subscription' AND appointment_id IS NULL)
  )
);

CREATE INDEX billing_ledger_entries_org_idx
  ON billing_ledger_entries (organisation_id, occurred_at DESC);

-- One fee per organisation per referral. A partial unique index makes
-- double-accrual UNREPRESENTABLE rather than merely unlikely — a retried
-- request must not bill a clinic twice for one referral. Partial, because two
-- subscription charges for one organisation are entirely normal: they are
-- different billing periods.
CREATE UNIQUE INDEX billing_ledger_one_fee_per_org_per_appointment
  ON billing_ledger_entries (appointment_id, organisation_id)
  WHERE kind = 'coordination_fee';

ALTER TABLE billing_fee_schedule   ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_fee_schedule   FORCE  ROW LEVEL SECURITY;
ALTER TABLE billing_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_ledger_entries FORCE  ROW LEVEL SECURITY;

-- The rate card is readable by any authenticated caller: a clinic is entitled
-- to know what a referral costs it before making one.
CREATE POLICY fee_schedule_readable ON billing_fee_schedule FOR SELECT
  USING (app_current_role() IS NOT NULL);

CREATE POLICY ledger_entries_member ON billing_ledger_entries FOR SELECT
  USING (app_member_of(organisation_id));

CREATE POLICY ledger_entries_ops ON billing_ledger_entries FOR SELECT
  USING (app_current_role() = 'admin');

-- Accrual runs in a system context, which supplies an explicit 'admin' role
-- rather than querying with no identity at all — the same pattern
-- BillingService.handleWebhook used for Stripe callbacks. A clinic must not be
-- able to write its own ledger, so there is deliberately no member INSERT.
CREATE POLICY ledger_entries_system_insert ON billing_ledger_entries FOR INSERT
  WITH CHECK (app_current_role() = 'admin');

CREATE POLICY ledger_entries_system_update ON billing_ledger_entries FOR UPDATE
  USING (app_current_role() = 'admin')
  WITH CHECK (app_current_role() = 'admin');

GRANT SELECT ON billing_fee_schedule TO mir_app;
GRANT SELECT, INSERT, UPDATE ON billing_ledger_entries TO mir_app;

-- ---------------------------------------------------------------------------
-- The patient's card is gone.
--
-- billing_payments is keyed to patients_patients and was gated on
-- app_current_role() = 'patient'. Migration 0021 removed the role and dropped
-- those policies, which left the table reachable by nobody. There is no
-- patient, so there is no payer and no rail.
--
-- payment-rail.ts is kept in the codebase as an unwired seam: organisation-side
-- collection will need one when L7 resolves, and the interface is the part
-- worth preserving.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS billing_webhook_events;
DROP TABLE IF EXISTS billing_payments;

-- ---------------------------------------------------------------------------
-- The appointment status machine.
--
-- 'pending_payment' and 'authorised' are artefacts of DECISION D2 — "authorise
-- at booking, capture on the doctor's acceptance" — against the patient's card.
-- With no card, an appointment can never enter either, and leaving them in the
-- CHECK would leave two unreachable states every reader has to rule out.
--
-- 'declined' is distinct from 'cancelled' and must stay distinct: declined is
-- the receiving doctor refusing, cancelled is the referring side withdrawing.
-- They mean different things to the referring clinic and they accrue
-- differently.
--
-- 'no_show' STAYS. Migration 0014 added it deliberately — "not a kind of
-- cancellation" — and it is still reachable: SchedulingService.markNoShow
-- writes it, the practice-verbs suite asserts it, and the web badge renders it
-- in red rather than as a shade of cancelled. It is a clinical outcome, not a
-- payment artefact, so removing it with the payment states would delete a
-- working verb.
-- ---------------------------------------------------------------------------
ALTER TABLE scheduling_appointments DROP CONSTRAINT IF EXISTS scheduling_appointments_status_check;

UPDATE scheduling_appointments
   SET status = 'pending'
 WHERE status IN ('pending_payment', 'authorised');

ALTER TABLE scheduling_appointments
  ALTER COLUMN status SET DEFAULT 'pending',
  ADD CONSTRAINT scheduling_appointments_status_check
    CHECK (status IN ('pending','confirmed','declined','cancelled','completed','no_show'));

-- A declined slot must be bookable again, so the double-booking exclusion has
-- to ignore it as well as 'cancelled'. Otherwise one refusal takes the slot out
-- of circulation permanently. The constraint is dropped and recreated because
-- its WHERE clause cannot be altered in place.
ALTER TABLE scheduling_appointments
  DROP CONSTRAINT IF EXISTS scheduling_appointments_doctor_id_tstzrange_excl;

ALTER TABLE scheduling_appointments
  ADD CONSTRAINT scheduling_appointments_doctor_id_tstzrange_excl
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status NOT IN ('cancelled', 'declined'));

-- ---------------------------------------------------------------------------
-- Adding a state breaks every predicate that enumerated the old one.
--
-- `app_study_linked_to_my_appointment` gated imaging on `status <> 'cancelled'`
-- — which was a complete way to say "this referral still stands" only while
-- 'declined' did not exist. With it, a receiving doctor who REFUSED a referral
-- would keep seeing its imaging whenever triage is enabled, because a declined
-- appointment is not a cancelled one.
--
-- Nothing else about the predicate changes: consent is still required, the
-- appointment must still be the caller's, and triage still decides whether
-- 'pending' is enough. Only the set of statuses that count as standing moves.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_study_linked_to_my_appointment(p_study uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM scheduling_appointment_studies sas
    JOIN scheduling_appointments a ON a.id = sas.appointment_id
    WHERE sas.study_id = p_study
      AND a.doctor_id = app_current_user_id()
      AND a.status NOT IN ('cancelled', 'declined')
      AND (app_triage_before_payment() OR a.status IN ('confirmed', 'completed'))
  );
$$;

COMMIT;
