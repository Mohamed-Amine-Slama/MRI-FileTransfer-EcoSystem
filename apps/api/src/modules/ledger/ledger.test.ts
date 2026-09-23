import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { runWithContext, type RequestContext } from '../../shared/context/request-context';
import { DatabaseService } from '../../shared/db/database.service';
import {
  appUrl,
  createCase,
  createPatient,
  createPractice,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { LedgerService } from './internal/ledger.service';

let h: Harness;
let db: DatabaseService;
let ledger: LedgerService;

/**
 * Accrual runs under the system identity, which supplies an explicit 'admin'
 * role — the ledger's INSERT policy admits nobody else, so a clinic cannot
 * write its own ledger even by reaching the service directly.
 */
const sys = (userId: string): RequestContext => ({
  userId,
  role: 'admin',
  ipAddress: '41.208.1.5',
  userAgent: 'test',
  requestId: 'req-ledger-test',
});

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 3 } as AppConfig);
  ledger = new LedgerService(db);
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

async function referral(): Promise<{
  src: { orgId: string; doctorId: string };
  dst: { orgId: string; doctorId: string };
  appt: string;
}> {
  const src = await createPractice(h.owner, 'libya_doctor');
  const dst = await createPractice(h.owner, 'tunisia_doctor');
  const patient = await createPatient(h.owner, src.doctorId);
  const appt = await createCase(h.owner, patient, dst.doctorId, 'paid');
  return { src, dst, appt };
}

/** A quoted, paid case carrying the split the quote locked. */
async function priced(): Promise<Awaited<ReturnType<typeof referral>>> {
  const r = await referral();
  await h.owner.query(
    `UPDATE cases_cases
        SET quoted_amount_minor = 10000, quoted_currency = 'USD',
            quoted_at = now(), quote_expires_at = now() + interval '1 hour',
            clinic_share_minor = 3000, doctor_share_minor = 2000
      WHERE id = $1`,
    [r.appt],
  );
  return r;
}

describe('the consult split in the ledger (spec 2026-09-21 §3)', () => {
  const entries = async (caseId: string) =>
    (
      await h.owner.query<{ organisation_id: string; kind: string; amount_minor: string }>(
        `SELECT organisation_id, kind, amount_minor FROM billing_ledger_entries
          WHERE case_id = $1 ORDER BY kind`,
        [caseId],
      )
    ).rows;

  it('the clinic owes the price less its own share: $100 − $30 = $70', async () => {
    const { src, appt } = await priced();
    await runWithContext(sys(src.doctorId), () => ledger.accrueClinicRemittance(appt));
    expect(await entries(appt)).toEqual([
      { organisation_id: src.orgId, kind: 'coordination_fee', amount_minor: '7000' },
    ]);
  });

  it('the doctor is owed their share: $20', async () => {
    const { src, dst, appt } = await priced();
    await runWithContext(sys(src.doctorId), () => ledger.accrueDoctorPayout(appt));
    expect(await entries(appt)).toEqual([
      { organisation_id: dst.orgId, kind: 'doctor_payout', amount_minor: '2000' },
    ]);
  });

  it('accrues each exactly once, however often it is asked', async () => {
    // A retried request must not bill a clinic twice or pay a doctor twice.
    // Partial unique indexes make that impossible rather than unlikely.
    const { src, appt } = await priced();
    await runWithContext(sys(src.doctorId), async () => {
      await ledger.accrueClinicRemittance(appt);
      await ledger.accrueClinicRemittance(appt);
      await ledger.accrueDoctorPayout(appt);
      await ledger.accrueDoctorPayout(appt);
    });
    expect((await entries(appt)).map((e) => e.kind)).toEqual(['coordination_fee', 'doctor_payout']);
  });

  it('accrues nothing for a case quoted before the split existed', async () => {
    // No invented charge: a case without a locked split has nothing to bill.
    const { src, appt } = await referral();
    const out = await runWithContext(sys(src.doctorId), async () => [
      await ledger.accrueClinicRemittance(appt),
      await ledger.accrueDoctorPayout(appt),
    ]);
    expect(out).toEqual([null, null]);
    expect(await entries(appt)).toEqual([]);
  });
});

describe('ledger visibility', () => {
  it("an organisation reads its own entries and no other organisation's", async () => {
    const { src, dst, appt } = await priced();

    await runWithContext(sys(src.doctorId), async () => {
      await ledger.accrueClinicRemittance(appt);
      await ledger.accrueDoctorPayout(appt);
    });

    const mine = await runWithContext({ ...sys(src.doctorId), role: 'libya_doctor' }, () =>
      ledger.listForOrganisation(src.orgId),
    );
    expect(mine.length).toBe(1);
    expect(mine[0]?.kind).toBe('coordination_fee');

    // Not an authorisation error — RLS returns nothing, which is the same
    // answer as "there is nothing there" and leaks no existence.
    const theirs = await runWithContext({ ...sys(src.doctorId), role: 'libya_doctor' }, () =>
      ledger.listForOrganisation(dst.orgId),
    );
    expect(theirs).toEqual([]);

    // The doctor's organisation reads its payout, as its own kind.
    const payouts = await runWithContext({ ...sys(dst.doctorId), role: 'tunisia_doctor' }, () =>
      ledger.listForOrganisation(dst.orgId),
    );
    expect(payouts.map((e) => [e.kind, e.amount.amountMinor])).toEqual([['doctor_payout', 2000]]);
  });

  it('a clinic cannot write its own ledger', async () => {
    // The INSERT policy admits only the system role. Reaching the service
    // directly as a doctor must accrue nothing.
    const { src, appt } = await priced();

    await runWithContext({ ...sys(src.doctorId), role: 'libya_doctor' }, () =>
      ledger.accrueClinicRemittance(appt),
    );

    const rows = await h.owner.query(
      `SELECT id FROM billing_ledger_entries WHERE case_id = $1`,
      [appt],
    );
    expect(rows.rows).toEqual([]);
  });
});
