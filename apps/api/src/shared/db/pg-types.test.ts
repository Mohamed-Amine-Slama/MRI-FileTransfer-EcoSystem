import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/config.schema';
import type { RequestContext } from '../context/request-context';
import { DatabaseService } from './database.service';
import {
  appUrl,
  createPatient,
  createUser,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from './testing/rls-harness';

/**
 * Regression test for a date bug that shifted every patient's date of birth by
 * one day.
 *
 * `pg` parses a DATE column into a JS Date at LOCAL midnight; converting that
 * to an ISO string moves it to UTC, and on any server east of UTC it lands on
 * the previous day. P3.3 has the doctor confirm patient identity from name AND
 * date of birth, so a DOB that depends on server timezone directly undermines
 * the check that prevents two people being merged into one record.
 *
 * This test pins the server's timezone well east of UTC, which is where the
 * original bug reproduced.
 */

let h: Harness;
let db: DatabaseService;

const ctx = (userId: string, role: RequestContext['role']): RequestContext => ({
  userId,
  role,
  ipAddress: undefined,
  userAgent: undefined,
  requestId: 'pg-types-test',
});

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 2 } as AppConfig);
  await truncateAll(h.owner);
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
});

describe('PostgreSQL type parsing', () => {
  it('returns a calendar date as the exact stored string, in any timezone', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor); // DOB 1985-06-15

    const readBack = await db.txAs(ctx(doctor, 'libya_doctor'), async (tx) => {
      const res = await tx.query<{ date_of_birth: string }>(
        'SELECT date_of_birth FROM patients_patients WHERE id = $1',
        [patient],
      );
      return res.rows[0]?.date_of_birth;
    });

    expect(readBack).toBe('1985-06-15');
    expect(typeof readBack).toBe('string');
  });

  it('does not shift the date when the server runs east of UTC', async () => {
    const original = process.env['TZ'];
    try {
      // Tripoli is UTC+2. Under the old behaviour this produced 1985-06-14.
      process.env['TZ'] = 'Africa/Tripoli';

      const doctor = await createUser(h.owner, 'libya_doctor');
      const patient = await createPatient(h.owner, doctor);

      const readBack = await db.txAs(ctx(doctor, 'libya_doctor'), async (tx) => {
        const res = await tx.query<{ date_of_birth: string }>(
          'SELECT date_of_birth FROM patients_patients WHERE id = $1',
          [patient],
        );
        return res.rows[0]?.date_of_birth;
      });

      expect(readBack).toBe('1985-06-15');
    } finally {
      if (original === undefined) delete process.env['TZ'];
      else process.env['TZ'] = original;
    }
  });

  it('keeps bigint byte counts as strings rather than losing precision', async () => {
    const result = await db.txAs(ctx('018f8e6a-0000-7000-8000-000000000001', 'admin'), async (tx) => {
      const res = await tx.query<{ big: string }>(
        "SELECT 9007199254740993::bigint AS big", // MAX_SAFE_INTEGER + 2
      );
      return res.rows[0]?.big;
    });

    // As a JS number this would come back as 9007199254740992 — silently wrong.
    expect(result).toBe('9007199254740993');
  });

  it('still returns timestamptz as a Date (§6 requires UTC instants)', async () => {
    const result = await db.txAs(ctx('018f8e6a-0000-7000-8000-000000000001', 'admin'), async (tx) => {
      const res = await tx.query<{ now: Date }>('SELECT now() AS now');
      return res.rows[0]?.now;
    });

    // A timestamptz genuinely is an instant; only calendar dates are strings.
    expect(result).toBeInstanceOf(Date);
  });
});
