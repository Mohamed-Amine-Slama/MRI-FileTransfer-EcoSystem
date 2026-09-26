import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { runWithContext } from '../../shared/context/request-context';
import { DatabaseService } from '../../shared/db/database.service';
import {
  appUrl,
  createPractice,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { PlansService } from './internal/plans.service';

let h: Harness;
let db: DatabaseService;
let plans: PlansService;

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 5 } as AppConfig);
  plans = new PlansService(db);
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

/**
 * Migration 0022 — two catalogues, one per corridor side.
 *
 * The assertions that matter are the cross-side refusals. The side match is
 * enforced by a trigger rather than by the service precisely so that a write
 * arriving through a path nobody has written yet is still refused, so these
 * tests go through the OWNER connection: owner bypasses RLS, which means a
 * pass here cannot be a policy accidentally doing the trigger's job.
 */
describe('side-scoped plans', () => {
  it('the public catalogue carries a side for every tier', async () => {
    const res = await h.app.query<{ code: string; side: string }>(
      `SELECT code, side FROM billing_public_plans()`,
    );
    expect(res.rows.length).toBe(2);
    expect(res.rows.filter((r) => r.side === 'source').length).toBe(1);
    expect(res.rows.filter((r) => r.side === 'destination').length).toBe(1);
  });

  it('names every tier with a prefix that agrees with its side', async () => {
    const res = await h.app.query<{ code: string; side: string }>(
      `SELECT code, side FROM billing_public_plans()`,
    );
    for (const row of res.rows) {
      expect(row.code.startsWith(row.side === 'source' ? 'src_' : 'dst_')).toBe(true);
    }
  });

  it('an organisation may subscribe to a plan on its own side', async () => {
    const { orgId } = await createPractice(h.owner, 'libya_doctor'); // source
    await h.owner.query(
      `INSERT INTO billing_subscriptions (organisation_id, plan_code, period_end)
       VALUES ($1, 'src_clinic', now() + interval '30 days')`,
      [orgId],
    );
    const res = await h.owner.query(
      `SELECT 1 FROM billing_subscriptions WHERE organisation_id = $1`,
      [orgId],
    );
    expect(res.rows.length).toBe(1);
  });

  it('an organisation cannot subscribe to a plan on the other side', async () => {
    const { orgId } = await createPractice(h.owner, 'libya_doctor'); // source
    await expect(
      h.owner.query(
        `INSERT INTO billing_subscriptions (organisation_id, plan_code, period_end)
         VALUES ($1, 'dst_clinic', now() + interval '30 days')`,
        [orgId],
      ),
    ).rejects.toThrow(/cannot subscribe to a destination plan/);
  });

  it('the trigger also refuses a cross-side UPDATE', async () => {
    const { orgId } = await createPractice(h.owner, 'tunisia_doctor'); // destination
    await h.owner.query(
      `INSERT INTO billing_subscriptions (organisation_id, plan_code, period_end)
       VALUES ($1, 'dst_solo', now() + interval '30 days')`,
      [orgId],
    );
    await expect(
      h.owner.query(
        `UPDATE billing_subscriptions SET plan_code = 'src_solo' WHERE organisation_id = $1`,
        [orgId],
      ),
    ).rejects.toThrow(/cannot subscribe to a source plan/);
  });
});

/**
 * Migration 0033 — spec 2026-09-21 §4: one yearly plan per side.
 */
describe('yearly plans', () => {
  const ctx = (userId: string, role: 'libya_doctor' | 'tunisia_doctor') => ({
    userId,
    role,
    ipAddress: '41.208.1.5',
    userAgent: 'vitest',
    requestId: 'plans-test',
  });

  const periodDays = async (orgId: string): Promise<number> => {
    const res = await h.owner.query<{ days: number }>(
      `SELECT (period_end::date - period_start::date) AS days
         FROM billing_subscriptions WHERE organisation_id = $1`,
      [orgId],
    );
    return Number(res.rows[0]?.days);
  };

  it('the catalogue is the two yearly plans at the owner\'s prices', async () => {
    const tiers = await plans.catalogue();
    expect(tiers.map((t) => [t.code, t.price, t.interval])).toEqual([
      ['dst_doctor_yearly', { amountMinor: 1000000, currency: 'TND' }, 'year'],
      ['src_clinic_yearly', { amountMinor: 100000, currency: 'USD' }, 'year'],
    ]);
  });

  it('subscribing to a yearly plan opens a one-year period', async () => {
    const { orgId, doctorId } = await createPractice(h.owner, 'libya_doctor');
    await runWithContext(ctx(doctorId, 'libya_doctor'), () =>
      plans.changePlan('src_clinic_yearly'),
    );
    expect(await periodDays(orgId)).toBeGreaterThanOrEqual(365);
  });

  it('moving from a retired monthly tier to the yearly plan restarts the period', async () => {
    const { orgId, doctorId } = await createPractice(h.owner, 'tunisia_doctor');
    await h.owner.query(
      `INSERT INTO billing_subscriptions (organisation_id, plan_code, period_end)
       VALUES ($1, 'dst_clinic', now() + interval '1 month')`,
      [orgId],
    );
    await runWithContext(ctx(doctorId, 'tunisia_doctor'), () =>
      plans.changePlan('dst_doctor_yearly'),
    );
    expect(await periodDays(orgId)).toBeGreaterThanOrEqual(365);
  });

  it('still refuses a plan from the other side', async () => {
    const { doctorId } = await createPractice(h.owner, 'libya_doctor');
    await expect(
      runWithContext(ctx(doctorId, 'libya_doctor'), () => plans.changePlan('dst_doctor_yearly')),
    ).rejects.toThrow(/cannot subscribe to a destination plan/);
  });
});
