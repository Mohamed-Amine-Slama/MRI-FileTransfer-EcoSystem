-- Case references, allocated server-side.
--
-- WHY THIS EXISTS NOW. §5.7 P1 says a coordination fee is charged per case and
-- therefore always carries its case reference, and `coordinationFeeEntrySchema`
-- makes `caseRef` required. Nothing in the API ever allocated one — the only
-- case references in the repository are hard-coded in the web mock layer — so a
-- ledger entry could not be constructed at all without inventing the number, or
-- weakening the contract to let a fee exist that nobody can trace to a referral.
-- Inventing it in the service would have put a different scheme in every caller.
--
-- THE REFERENCE BELONGS TO THE REFERRAL, NOT TO THE CHARGE. Both sides' fees
-- are two charges for ONE case, so the reference lives on the appointment and
-- both entries copy it. Putting it on the ledger entry would have produced two
-- references for one referral, which is precisely what a provider quoting a
-- number over the phone cannot survive.
--
-- The format is `MIR-YYYY-NNNN` (packages/contracts/src/case.ts): Latin-script
-- and fixed-width so it stays readable inside Arabic RTL text (§4.2).

BEGIN;

-- ---------------------------------------------------------------------------
-- One counter per year, so the sequence restarts each January and the year in
-- the reference means something.
--
-- A table rather than a PostgreSQL sequence, because a sequence cannot be
-- scoped per year without creating one per year, and its non-transactional
-- behaviour would leave gaps on every rolled-back booking. Gaps are not fatal
-- but they are the kind of thing a provider notices and asks about.
-- ---------------------------------------------------------------------------
CREATE TABLE scheduling_case_ref_counters (
  year           integer PRIMARY KEY CHECK (year BETWEEN 1000 AND 9999),
  last_sequence  integer NOT NULL DEFAULT 0 CHECK (last_sequence >= 0)
);

-- SECURITY DEFINER: allocating a reference must not require a caller to hold
-- write access to the counter table, or every booking role would need it.
--
-- The UPSERT is what makes concurrent bookings safe: the second caller blocks
-- on the first's row lock rather than reading a stale maximum, so two referrals
-- can never receive the same number.
CREATE OR REPLACE FUNCTION scheduling_next_case_ref() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_year integer := EXTRACT(year FROM now())::integer;
  v_seq  integer;
BEGIN
  INSERT INTO scheduling_case_ref_counters (year, last_sequence)
  VALUES (v_year, 1)
  ON CONFLICT (year) DO UPDATE
    SET last_sequence = scheduling_case_ref_counters.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  -- MAX_SEQUENCE in the contract. Refusing loudly beats emitting 'MIR-2026-10000',
  -- which would fail the contract's regex somewhere far from here.
  IF v_seq > 9999 THEN
    RAISE EXCEPTION 'case reference sequence exhausted for %', v_year
      USING ERRCODE = '22003';
  END IF;

  RETURN 'MIR-' || v_year::text || '-' || lpad(v_seq::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION scheduling_next_case_ref() TO mir_app;

-- ---------------------------------------------------------------------------
-- The reference on the referral.
--
-- A DEFAULT rather than a service call, so an appointment cannot be created
-- without one by any path — including the test harness and a psql session.
-- ---------------------------------------------------------------------------
ALTER TABLE scheduling_appointments ADD COLUMN case_ref text;

UPDATE scheduling_appointments SET case_ref = scheduling_next_case_ref() WHERE case_ref IS NULL;

ALTER TABLE scheduling_appointments
  ALTER COLUMN case_ref SET NOT NULL,
  ALTER COLUMN case_ref SET DEFAULT scheduling_next_case_ref(),
  ADD CONSTRAINT scheduling_appointments_case_ref_format
    CHECK (case_ref ~ '^MIR-[0-9]{4}-[0-9]{4}$'),
  ADD CONSTRAINT scheduling_appointments_case_ref_unique UNIQUE (case_ref);

COMMIT;
