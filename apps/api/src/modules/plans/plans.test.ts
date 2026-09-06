import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPractice,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';

let h: Harness;

beforeAll(async () => {
  h = await setupTestDatabase();
}, 120_000);

afterAll(async () => {
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
    expect(res.rows.length).toBe(6);
    expect(res.rows.filter((r) => r.side === 'source').length).toBe(3);
    expect(res.rows.filter((r) => r.side === 'destination').length).toBe(3);
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
