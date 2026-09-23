import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { runWithContext, type RequestContext } from '../../shared/context/request-context';
import { DatabaseService } from '../../shared/db/database.service';
import type { MailSender } from '../../shared/mail';
import {
  appUrl,
  createPractice,
  createUser,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { OrganisationsService } from '../organisations';
import { DirectoryService } from './internal/directory.service';

/**
 * "Fix the availability of the Tunisian doctor" — spec 2026-09-21 §7.
 *
 * Reproduced 2026-09-23: approving a Tunisian doctor granted the role but
 * created no doctor profile, so the availability switch updated zero rows and
 * answered 404, and the doctor could never appear in a clinic's directory. This
 * is the whole path an ops approval has to open, end to end.
 */
let h: Harness;
let db: DatabaseService;
let organisations: OrganisationsService;
let directory: DirectoryService;

const ctx = (userId: string, role: RequestContext['role']): RequestContext => ({
  userId,
  role,
  ipAddress: '41.208.1.5',
  userAgent: 'vitest',
  requestId: 'approval-availability',
});

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 4 } as AppConfig);
  type KeycloakParam = ConstructorParameters<typeof OrganisationsService>[1];
  organisations = new OrganisationsService(
    db,
    { isConfigured: () => false } as unknown as KeycloakParam,
    { send: () => Promise.resolve() } as unknown as MailSender,
    { APP_PUBLIC_URL: 'http://localhost:3001' } as AppConfig,
  );
  directory = new DirectoryService(db);
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

/** A Tunisian applicant with a pending doctor organisation, as sign-up leaves them. */
async function pendingDoctor(specialty: string): Promise<{ userId: string; orgId: string }> {
  const userId = await createUser(h.owner, 'applicant');
  const org = await h.owner.query<{ id: string }>(
    `INSERT INTO identity_organisations (kind, legal_name, corridor_id, side, credentials)
     VALUES ('doctor', 'Practice ' || left(md5(random()::text), 6), 'ly-tn', 'destination', $1)
     RETURNING id`,
    [JSON.stringify({ cnomNumber: 'TN-TEST-1', specialty })],
  );
  const orgId = org.rows[0]!.id;
  await h.owner.query(
    `INSERT INTO identity_memberships (organisation_id, user_id, seat_role) VALUES ($1, $2, 'owner')`,
    [orgId, userId],
  );
  return { userId, orgId };
}

describe('approving a Tunisian doctor opens their door', () => {
  it('creates a verified profile with a lowercase specialty', async () => {
    const { userId, orgId } = await pendingDoctor('Radiology');
    const ops = await createUser(h.owner, 'admin');
    await runWithContext(ctx(ops, 'admin'), () => organisations.decide(orgId, true));

    const row = await h.owner.query<{ specialty: string; verified: boolean; license_number: string }>(
      `SELECT specialty, verified_at IS NOT NULL AS verified, license_number
         FROM identity_doctor_profiles WHERE user_id = $1`,
      [userId],
    );
    expect(row.rows[0]).toEqual({ specialty: 'radiology', verified: true, license_number: 'TN-TEST-1' });
  });

  it('lets the doctor switch on, and a clinic then finds them', async () => {
    const { userId, orgId } = await pendingDoctor('radiology');
    const ops = await createUser(h.owner, 'admin');
    await runWithContext(ctx(ops, 'admin'), () => organisations.decide(orgId, true));

    await runWithContext(ctx(userId, 'tunisia_doctor'), () => directory.setAccepting(true));

    const { doctorId: clinic } = await createPractice(h.owner, 'libya_doctor');
    const found = await runWithContext(ctx(clinic, 'libya_doctor'), () =>
      directory.listAcceptingDoctors('radiology'),
    );
    expect(found.map((d) => d.id)).toContain(userId);
  });
});
