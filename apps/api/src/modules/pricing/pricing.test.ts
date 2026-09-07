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

describe('PricingService', () => {
  it('quotes base x tier x surge', async () => {
    // Five accepting radiologists — the densest rung, x1.00 — one of whom is
    // the senior the lab picked.
    await seedAcceptingDoctors(h.owner, { specialty: 'radiology', count: 4 });
    const doctorId = await seedDoctor(h.owner, {
      specialty: 'radiology',
      tier: 'senior',
      accepting: true,
    });

    const q = await quote('radiology', doctorId);

    expect(q.amountMinor).toBe(4800); // 4000 x 1.20 x 1.00
    expect(q.currency).toBe('USD');
    expect(q.tierBp).toBe(12_000);
    expect(q.surgeBp).toBe(10_000);
    expect(q.acceptingCount).toBe(5);
  });

  it('surges when the specialty thins out', async () => {
    await seedAcceptingDoctors(h.owner, { specialty: 'radiology', count: 1 });
    const doctorId = await seedDoctor(h.owner, {
      specialty: 'radiology',
      tier: 'standard',
      accepting: true,
    });

    const q = await quote('radiology', doctorId);

    expect(q.acceptingCount).toBe(2);
    expect(q.surgeBp).toBe(13_000);
    expect(q.amountMinor).toBe(5200); // 4000 x 1.00 x 1.30
  });

  /**
   * Nobody accepting is closed, not expensive. This must be a clean refusal the
   * UI can render, not a 500 and not a huge number.
   */
  it('refuses to quote a closed specialty', async () => {
    const doctorId = await seedDoctor(h.owner, { specialty: 'oncology', accepting: false });
    await expect(quote('oncology', doctorId)).rejects.toBeInstanceOf(SpecialtyClosedError);
  });

  it('refuses a specialty with no rate rather than inventing one', async () => {
    await seedAcceptingDoctors(h.owner, { specialty: 'dermatology', count: 5 });
    const doctorId = await seedDoctor(h.owner, {
      specialty: 'dermatology',
      accepting: true,
    });
    await expect(quote('dermatology', doctorId)).rejects.toThrow(/no active rate/i);
  });

  /**
   * A doctor who has switched off is still quotable — the lab may be looking at
   * a directory entry that went dark a second ago — but the price must not
   * silently become free because their profile row was unreadable.
   */
  it('falls back to the base tier rather than to a free consult', async () => {
    await seedAcceptingDoctors(h.owner, { specialty: 'radiology', count: 5 });
    const unknown = '00000000-0000-7000-8000-000000000000';
    const q = await quote('radiology', unknown);
    expect(q.tierBp).toBe(10_000);
    expect(q.amountMinor).toBe(4000);
  });
});
