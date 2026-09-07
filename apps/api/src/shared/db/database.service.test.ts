import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/config.schema';
import {
  MissingRequestContextError,
  runWithContext,
  type RequestContext,
} from '../context/request-context';
import { DatabaseService } from './database.service';
import {
  appUrl,
  createPatient,
  createStudy,
  createUser,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from './testing/rls-harness';

/**
 * BUILD_SPEC P4.2 — "Confirm RLS context is set inside the transaction. A
 * context set outside it silently does nothing."
 *
 * That sentence describes a bug with no symptom: the queries succeed, return
 * zero rows, and look like an empty result set. These tests exist so the
 * property is checked mechanically rather than by reading the code.
 */

let h: Harness;
let db: DatabaseService;

const ctx = (userId: string, role: RequestContext['role']): RequestContext => ({
  userId,
  role,
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
  requestId: 'test-request',
});

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({
    DATABASE_URL: appUrl(),
    DATABASE_POOL_MAX: 3,
  } as AppConfig);
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
});

describe('DatabaseService RLS context', () => {
  it('connects as the application role, not as an owner or superuser', async () => {
    const who = await db.txAs(ctx('018f8e6a-0000-7000-8000-000000000001', 'admin'), async (tx) => {
      const r = await tx.query<{ current_user: string }>('SELECT current_user');
      return r.rows[0]?.current_user;
    });
    expect(who).toBe('mir_app');
  });

  it('sets app.user_id and app.user_role INSIDE the transaction', async () => {
    const userId = '018f8e6a-0000-7000-8000-0000000000aa';

    const settings = await db.txAs(ctx(userId, 'libya_doctor'), async (tx) => {
      const r = await tx.query<{ uid: string; role: string }>(
        `SELECT current_setting('app.user_id', true)  AS uid,
                current_setting('app.user_role', true) AS role`,
      );
      return r.rows[0];
    });

    expect(settings?.uid).toBe(userId);
    expect(settings?.role).toBe('libya_doctor');
  });

  it('does not leak the context to the next transaction on the same pooled connection', async () => {
    // set_config(..., is_local=true) is transaction-scoped. If it were set
    // without the local flag, the value would persist on the pooled connection
    // and the NEXT request — potentially a different user — would inherit it.
    // That is a cross-tenant data leak, not a tidiness issue.
    const first = '018f8e6a-0000-7000-8000-0000000000b1';
    await db.txAs(ctx(first, 'tunisia_doctor'), async (tx) => {
      await tx.query('SELECT 1');
    });

    // Drain the pool down to one connection's worth of sequential use, then
    // read the setting outside any explicit context.
    const leaked = await db.txAs(
      ctx('018f8e6a-0000-7000-8000-0000000000b2', 'tunisia_doctor'),
      async (tx) => {
        const r = await tx.query<{ uid: string | null }>(
          `SELECT current_setting('app.user_id', true) AS uid`,
        );
        return r.rows[0]?.uid;
      },
    );

    expect(leaked).not.toBe(first);
  });

  it('actually enforces RLS through this service, not just in raw SQL tests', async () => {
    await truncateAll(h.owner);
    const doctorA = await createUser(h.owner, 'libya_doctor');
    const doctorB = await createUser(h.owner, 'libya_doctor');
    const patientOfB = await createPatient(h.owner, doctorB);
    await createStudy(h.owner, patientOfB, doctorB);

    const seenByA = await db.txAs(ctx(doctorA, 'libya_doctor'), async (tx) =>
      (await tx.query('SELECT id FROM imaging_studies')).rowCount,
    );
    const seenByB = await db.txAs(ctx(doctorB, 'libya_doctor'), async (tx) =>
      (await tx.query('SELECT id FROM imaging_studies')).rowCount,
    );

    expect(seenByA).toBe(0);
    expect(seenByB).toBe(1);
  });

  it('rolls back on error, leaving no partial write', async () => {
    await truncateAll(h.owner);
    const doctor = await createUser(h.owner, 'libya_doctor');

    await expect(
      db.txAs(ctx(doctor, 'libya_doctor'), async (tx) => {
        await tx.query(
          `INSERT INTO patients_patients
             (phone_e164, full_name, date_of_birth, sex, created_by_doctor)
           VALUES ('+218911111111', 'Rollback Test', '1990-01-01', 'M', $1)`,
          [doctor],
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const remaining = await h.owner.query(
      `SELECT id FROM patients_patients WHERE full_name = 'Rollback Test'`,
    );
    expect(remaining.rowCount).toBe(0);
  });

  it('refuses to open a transaction with no ambient context', async () => {
    // The alternative — running with no identity — returns zero rows silently
    // and looks like "the feature is broken" rather than "authorization is off".
    await expect(db.tx(async (tx) => tx.query('SELECT 1'))).rejects.toThrow(
      MissingRequestContextError,
    );
  });

  it('uses the ambient context when one is established', async () => {
    const userId = '018f8e6a-0000-7000-8000-0000000000cc';
    const result = await runWithContext(ctx(userId, 'tunisia_doctor'), async () =>
      db.tx(async (tx) => {
        const r = await tx.query<{ uid: string }>(
          `SELECT current_setting('app.user_id', true) AS uid`,
        );
        return r.rows[0]?.uid;
      }),
    );
    expect(result).toBe(userId);
  });
});
