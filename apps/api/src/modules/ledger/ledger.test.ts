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

describe('coordination fee accrual', () => {
  it('accrues one source entry and one destination entry at the corridor rates', async () => {
    // §5.7: both sides pay, at per-corridor rates. Two entries, never one
    // combined charge — the split is the decided part of the fee model.
    const { src, dst, appt } = await referral();

    await runWithContext(sys(src.doctorId), async () => {
      await ledger.accrueCoordinationFee(appt, 'source');
      await ledger.accrueCoordinationFee(appt, 'destination');
    });

    const rows = await h.owner.query<{ organisation_id: string; amount_minor: string }>(
      `SELECT organisation_id, amount_minor FROM billing_ledger_entries
       WHERE case_id = $1 ORDER BY amount_minor DESC`,
      [appt],
    );
    expect(rows.rows.length).toBe(2);
    expect(rows.rows[0]?.organisation_id).toBe(src.orgId);
    expect(rows.rows[0]?.amount_minor).toBe('3000');
    expect(rows.rows[1]?.organisation_id).toBe(dst.orgId);
    expect(rows.rows[1]?.amount_minor).toBe('2000');
  });

  it('does not double-accrue when the same side is accrued twice', async () => {
    // A retried request must not bill a clinic twice for one referral. The
    // partial unique index is what makes that impossible rather than unlikely.
    const { src, appt } = await referral();

    await runWithContext(sys(src.doctorId), async () => {
      await ledger.accrueCoordinationFee(appt, 'source');
      await ledger.accrueCoordinationFee(appt, 'source');
    });

    const rows = await h.owner.query(
      `SELECT id FROM billing_ledger_entries WHERE case_id = $1`,
      [appt],
    );
    expect(rows.rows.length).toBe(1);
  });

  it('accrues nothing and does not throw when the corridor has no active rate', async () => {
    // Moves ONE organisation to a corridor with no rate card, rather than
    // deactivating the seeded one.
    //
    // `truncateAll` does not reset billing_fee_schedule — it is seeded
    // configuration, not test data — so a global `SET active = false` here
    // leaks into every test that runs after this one in the file, and they fail
    // by accruing nothing for reasons that have nothing to do with them.
    const { src, appt } = await referral();
    await h.owner.query(`UPDATE identity_organisations SET corridor_id = 'ly-eg' WHERE id = $1`, [
      src.orgId,
    ]);

    const id = await runWithContext(sys(src.doctorId), () =>
      ledger.accrueCoordinationFee(appt, 'source'),
    );

    // A missing rate must not invent a charge, and must not block a referral:
    // a clinical hand-off does not wait on a billing configuration.
    expect(id).toBeNull();
    const rows = await h.owner.query(
      `SELECT id FROM billing_ledger_entries WHERE case_id = $1`,
      [appt],
    );
    expect(rows.rows).toEqual([]);
  });

  it("an organisation reads its own entries and no other organisation's", async () => {
    const { src, dst, appt } = await referral();

    await runWithContext(sys(src.doctorId), async () => {
      await ledger.accrueCoordinationFee(appt, 'source');
      await ledger.accrueCoordinationFee(appt, 'destination');
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
  });

  it('a clinic cannot write its own ledger', async () => {
    // The INSERT policy admits only the system role. Reaching the service
    // directly as a doctor must accrue nothing.
    const { src, appt } = await referral();

    await runWithContext({ ...sys(src.doctorId), role: 'libya_doctor' }, () =>
      ledger.accrueCoordinationFee(appt, 'source'),
    );

    const rows = await h.owner.query(
      `SELECT id FROM billing_ledger_entries WHERE case_id = $1`,
      [appt],
    );
    expect(rows.rows).toEqual([]);
  });
});
