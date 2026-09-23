import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { runWithContext, type RequestContext } from '../../shared/context/request-context';
import { DatabaseService } from '../../shared/db/database.service';
import {
  appUrl,
  seedAcceptingDoctors,
  seedDoctor,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { PricingService, SpecialtyClosedError } from './index';

let h: Harness;
let db: DatabaseService;
let pricing: PricingService;

/**
 * A quote is asked for by the LAB, and the lab has no policy granting it sight
 * of the doctors it is being priced against. Running the tests under the
 * referring role is the point: if the count or the tier lookup ever stops
 * being SECURITY DEFINER, these fail rather than quietly returning zero.
 */
const asLab = (userId: string): RequestContext => ({
  userId,
  role: 'libya_doctor',
  ipAddress: '41.208.1.5',
  userAgent: 'test',
  requestId: 'req-pricing-test',
});

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 3 } as AppConfig);
  pricing = new PricingService(db);
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

const quote = async (specialty: string, doctorId: string) =>
  runWithContext(asLab(doctorId), () =>
    pricing.quoteFor({ corridorId: 'ly-tn', specialty, doctorId }),
  );

describe('PricingService — the flat consult (spec 2026-09-21 §3)', () => {
  it('quotes the corridor price and its split, whatever the tier', async () => {
    // A senior doctor in a well-staffed specialty used to cost 4000 x 1.20.
    // Now every consult on the corridor is the same $100.
    await seedAcceptingDoctors(h.owner, { specialty: 'radiology', count: 4 });
    const doctorId = await seedDoctor(h.owner, {
      specialty: 'radiology',
      tier: 'senior',
      accepting: true,
    });

    const q = await quote('radiology', doctorId);

    expect(q).toMatchObject({
      amountMinor: 10000,
      currency: 'USD',
      clinicShareMinor: 3000,
      doctorShareMinor: 2000,
    });
  });

  it('does not surge when the specialty thins out', async () => {
    const doctorId = await seedDoctor(h.owner, {
      specialty: 'cardiology',
      tier: 'standard',
      accepting: true,
    });

    const q = await quote('cardiology', doctorId);

    expect(q.amountMinor).toBe(10000);
  });

  /**
   * Nobody accepting is closed, not expensive. This must be a clean refusal the
   * UI can render, not a 500 and not a huge number.
   */
  it('refuses to quote a closed specialty', async () => {
    const doctorId = await seedDoctor(h.owner, { specialty: 'oncology', accepting: false });
    await expect(quote('oncology', doctorId)).rejects.toBeInstanceOf(SpecialtyClosedError);
  });

  it('refuses a corridor with no consult price rather than inventing one', async () => {
    // A doctor accepting on a corridor that has no price row: open, but unpriced.
    // Moves ONE practice rather than deleting the seeded price, which is
    // configuration that truncateAll does not restore.
    const doctorId = await seedDoctor(h.owner, { specialty: 'radiology', accepting: true });
    await h.owner.query(
      `UPDATE identity_organisations SET corridor_id = 'ly-eg'
        WHERE id IN (SELECT organisation_id FROM identity_memberships WHERE user_id = $1)`,
      [doctorId],
    );
    await expect(
      runWithContext(asLab(doctorId), () =>
        pricing.quoteFor({ corridorId: 'ly-eg', specialty: 'radiology', doctorId }),
      ),
    ).rejects.toThrow(/no consult price/i);
  });
});
