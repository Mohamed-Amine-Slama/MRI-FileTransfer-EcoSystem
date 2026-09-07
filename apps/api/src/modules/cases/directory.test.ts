import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { runWithContext, type RequestContext } from '../../shared/context/request-context';
import { DatabaseService } from '../../shared/db/database.service';
import {
  appUrl,
  createPractice,
  createUser,
  seedAcceptingDoctors,
  seedDoctor,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { DirectoryService } from './internal/directory.service';

/**
 * The doctor directory — consult-model spec Part 2.
 *
 * THE FAILURE THIS FILE EXISTS TO CATCH IS AN EMPTY LIST. A lab matches no
 * SELECT policy on `identity_doctor_profiles`, so the obvious join returns
 * zero rows and RLS reports nothing — the directory just looks like a quiet
 * day. Every assertion here therefore runs as a lab against the `mir_app`
 * role, never as the owner and never as an admin.
 */

let h: Harness;
let db: DatabaseService;
let directory: DirectoryService;

const ctx = (userId: string, role: RequestContext['role']): RequestContext => ({
  userId,
  role,
  ipAddress: '41.208.1.5',
  userAgent: 'vitest',
  requestId: 'directory-test',
});

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 4 } as AppConfig);
  directory = new DirectoryService(db);
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

/** A seated referring lab. */
async function lab(): Promise<string> {
  const { doctorId } = await createPractice(h.owner, 'libya_doctor');
  return doctorId;
}

describe('browsing the directory', () => {
  it('lists doctors who are accepting, with an indicative price', async () => {
    const referrer = await lab();
    await seedAcceptingDoctors(h.owner, { specialty: 'radiology', count: 4 });
    await seedDoctor(h.owner, { specialty: 'radiology', tier: 'senior', accepting: true });

    const rows = await runWithContext(ctx(referrer, 'libya_doctor'), () =>
      directory.listAcceptingDoctors('radiology'),
    );

    expect(rows).toHaveLength(5);
    const senior = rows.find((r) => r.tierCode === 'senior');
    expect(senior?.indicativeAmountMinor).toBe(4800); // 4000 x 1.20 x 1.00
    expect(senior?.indicativeCurrency).toBe('USD');
    const standard = rows.find((r) => r.tierCode === 'standard');
    expect(standard?.indicativeAmountMinor).toBe(4000);
  });

  it('omits the doctors who have switched off', async () => {
    const referrer = await lab();
    await seedAcceptingDoctors(h.owner, { specialty: 'radiology', count: 2 });
    const off = await seedDoctor(h.owner, { specialty: 'radiology', accepting: false });

    const rows = await runWithContext(ctx(referrer, 'libya_doctor'), () =>
      directory.listAcceptingDoctors('radiology'),
    );

    expect(rows.map((r) => r.id)).not.toContain(off);
    expect(rows).toHaveLength(2);
  });

  /**
   * An unverified doctor may not receive imaging (Chapter V restricted
   * transfer). Listing one would offer the lab a pick that quoting then
   * refuses, which reads as a broken directory rather than as a safeguard.
   */
  it('omits an unverified doctor even when they are accepting', async () => {
    const referrer = await lab();
    await seedAcceptingDoctors(h.owner, { specialty: 'radiology', count: 1 });
    const unverified = await seedDoctor(h.owner, {
      specialty: 'radiology',
      accepting: true,
      verified: false,
    });

    const rows = await runWithContext(ctx(referrer, 'libya_doctor'), () =>
      directory.listAcceptingDoctors('radiology'),
    );

    expect(rows.map((r) => r.id)).not.toContain(unverified);
  });

  it('narrows to one specialty, and returns every specialty when asked for none', async () => {
    const referrer = await lab();
    await seedAcceptingDoctors(h.owner, { specialty: 'radiology', count: 2 });
    await seedAcceptingDoctors(h.owner, { specialty: 'cardiology', count: 1 });

    const radiology = await runWithContext(ctx(referrer, 'libya_doctor'), () =>
      directory.listAcceptingDoctors('radiology'),
    );
    const all = await runWithContext(ctx(referrer, 'libya_doctor'), () =>
      directory.listAcceptingDoctors(),
    );

    expect(radiology).toHaveLength(2);
    expect(all).toHaveLength(3);
  });

  /**
   * The corridor comes from the caller's own organisation and is not a
   * parameter, so there is nothing to change in order to browse — and then
   * refer into — a corridor the lab is not party to.
   */
  it('shows nothing from another corridor', async () => {
    const referrer = await lab();
    await seedAcceptingDoctors(h.owner, {
      specialty: 'radiology',
      count: 3,
      corridorId: 'ly-eg',
    });

    const rows = await runWithContext(ctx(referrer, 'libya_doctor'), () =>
      directory.listAcceptingDoctors('radiology'),
    );

    expect(rows).toEqual([]);
  });

  it('refuses a caller who is seated in no referring organisation', async () => {
    const stranger = await createUser(h.owner, 'libya_doctor');
    await expect(
      runWithContext(ctx(stranger, 'libya_doctor'), () => directory.listAcceptingDoctors()),
    ).rejects.toThrow(/referring organisation/i);
  });
});

describe('the availability switch', () => {
  it('opens and closes the caller’s own door', async () => {
    const doctorId = await seedDoctor(h.owner, { specialty: 'radiology', accepting: false });

    await runWithContext(ctx(doctorId, 'tunisia_doctor'), () => directory.setAccepting(true));
    const on = await h.owner.query<{ accepting_cases: boolean }>(
      'SELECT accepting_cases FROM identity_doctor_profiles WHERE user_id = $1',
      [doctorId],
    );
    expect(on.rows[0]?.accepting_cases).toBe(true);

    await runWithContext(ctx(doctorId, 'tunisia_doctor'), () => directory.setAccepting(false));
    const off = await h.owner.query<{ accepting_cases: boolean }>(
      'SELECT accepting_cases FROM identity_doctor_profiles WHERE user_id = $1',
      [doctorId],
    );
    expect(off.rows[0]?.accepting_cases).toBe(false);
  });

  /**
   * The function takes no user id, so there is no parameter with which to
   * switch a colleague off. This asserts the consequence: one doctor flipping
   * their own switch leaves everyone else's alone.
   */
  it('touches nobody else', async () => {
    const mine = await seedDoctor(h.owner, { specialty: 'radiology', accepting: false });
    const theirs = await seedDoctor(h.owner, { specialty: 'radiology', accepting: true });

    await runWithContext(ctx(mine, 'tunisia_doctor'), () => directory.setAccepting(true));

    const rows = await h.owner.query<{ user_id: string; accepting_cases: boolean }>(
      'SELECT user_id, accepting_cases FROM identity_doctor_profiles WHERE user_id = ANY($1)',
      [[mine, theirs]],
    );
    expect(rows.rows.find((r) => r.user_id === theirs)?.accepting_cases).toBe(true);
  });

  it('refuses a caller who is not a receiving doctor', async () => {
    const referrer = await lab();
    await expect(
      runWithContext(ctx(referrer, 'libya_doctor'), () => directory.setAccepting(true)),
    ).rejects.toThrow(/availability switch|privilege/i);
  });

  /** The role was granted but onboarding never wrote a profile row. */
  it('is a 404 for a doctor with no profile', async () => {
    const roleOnly = await createUser(h.owner, 'tunisia_doctor');
    await expect(
      runWithContext(ctx(roleOnly, 'tunisia_doctor'), () => directory.setAccepting(true)),
    ).rejects.toThrow(/no doctor profile/i);
  });
});
