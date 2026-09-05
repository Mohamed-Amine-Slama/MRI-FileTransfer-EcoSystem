import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { Pool } from 'pg';
import type { AppConfig } from '../../shared/config/config.schema';
import { runWithContext } from '../../shared/context/request-context';
import { DatabaseService } from '../../shared/db/database.service';
import type { MailSender } from '../../shared/mail';
import { OrganisationsService } from './internal/organisations.service';
import {
  appUrl,
  createUser,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';

/**
 * Who may provision whom — migrations 0018, 0019, 0020.
 *
 * THE LINE THIS SUITE DEFENDS. An invitation for an owner or member seat
 * resolves, on acceptance, to a CLINICAL role: `identity_grant_membership_role`
 * grants the corridor's doctor role. An invitation for an assistant seat
 * resolves to `assistant`, which reaches a calendar and no imaging at all.
 *
 * So "who may create which invitation" is the difference between hiring a
 * receptionist and minting a clinician. It is enforced by policy, not by a role
 * check in a service, and these run raw SQL as each identity to prove the
 * policies do it — a service-level test would pass while the database stayed
 * open.
 */

let h: Harness;
let app: Pool;

const asRole = async <T>(
  userId: string,
  role: string,
  fn: (c: import('pg').PoolClient) => Promise<T>,
  commit = false,
): Promise<T> => {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.user_role', role]);
    await client.query('SELECT set_config($1, $2, true)', ['app.triage_before_payment', 'false']);
    const out = await fn(client);
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
};

beforeAll(async () => {
  h = await setupTestDatabase();
  app = new Pool({ connectionString: appUrl(), max: 4 });
}, 120_000);

afterAll(async () => {
  await app?.end();
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

let seq = 0;
const uniqueEmail = (): string => `invitee-${Date.now()}-${++seq}@example.test`;

/** An approved hospital with an owner and one seated clinician. */
async function hospital(): Promise<{ orgId: string; owner: string; clinician: string }> {
  const owner = await createUser(h.owner, 'tunisia_doctor');
  const clinician = await createUser(h.owner, 'tunisia_doctor');
  const org = await h.owner.query<{ id: string }>(
    `INSERT INTO identity_organisations
       (kind, legal_name, corridor_id, side, verification_status, decided_at, seat_count)
     VALUES ('hospital', $1, 'ly-tn', 'destination', 'approved', now(), 20) RETURNING id`,
    [`Hospital ${Date.now()}-${++seq}`],
  );
  const orgId = org.rows[0]?.id;
  if (orgId === undefined) throw new Error('no organisation');
  await h.owner.query(
    `INSERT INTO identity_memberships (organisation_id, user_id, seat_role)
     VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
    [orgId, owner, clinician],
  );
  return { orgId, owner, clinician };
}

const insertInvitation = (
  client: import('pg').PoolClient,
  orgId: string,
  invitedBy: string,
  seatRole: string,
  specialty: string | null = null,
): Promise<unknown> =>
  client.query(
    `INSERT INTO identity_invitations
       (organisation_id, email, token_hash, seat_role, invited_by, expires_at, specialty)
     VALUES ($1, $2, $3, $4, $5, now() + interval '14 days', $6)`,
    [
      orgId,
      uniqueEmail(),
      createHash('sha256').update(randomBytes(32)).digest('hex'),
      seatRole,
      invitedBy,
      specialty,
    ],
  );

describe('a hospital provisioning its clinicians', () => {
  it('lets the owner invite a doctor, with a specialty', async () => {
    const { orgId, owner } = await hospital();

    await asRole(owner, 'tunisia_doctor', (c) =>
      insertInvitation(c, orgId, owner, 'member', 'Radiology'), true,
    );

    const rows = await h.owner.query<{ seat_role: string; specialty: string }>(
      'SELECT seat_role, specialty FROM identity_invitations',
    );
    expect(rows.rows[0]).toMatchObject({ seat_role: 'member', specialty: 'Radiology' });
  });

  it('refuses an outsider inviting into an organisation they do not belong to', async () => {
    const { orgId } = await hospital();
    const outsider = await createUser(h.owner, 'tunisia_doctor');

    await expect(
      asRole(outsider, 'tunisia_doctor', (c) =>
        insertInvitation(c, orgId, outsider, 'assistant'),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('a clinician provisioning an assistant', () => {
  it('may invite an assistant without owning the organisation', async () => {
    const { orgId, clinician } = await hospital();

    await asRole(clinician, 'tunisia_doctor', (c) =>
      insertInvitation(c, orgId, clinician, 'assistant'), true,
    );

    const rows = await h.owner.query('SELECT seat_role FROM identity_invitations');
    expect(rows.rows[0]).toMatchObject({ seat_role: 'assistant' });
  });

  it('MAY NOT invite another clinician — that would be minting a doctor', async () => {
    // The whole point of the seat_role condition inside the policy. A member
    // seat becomes a clinical role on acceptance, so a doctor who could issue
    // one could staff the corridor without an ops decision.
    const { orgId, clinician } = await hospital();

    await expect(
      asRole(clinician, 'tunisia_doctor', (c) => insertInvitation(c, orgId, clinician, 'member')),
    ).rejects.toThrow(/row-level security/i);
  });

  it('may not attribute an invitation to somebody else', async () => {
    const { orgId, clinician, owner } = await hospital();

    await expect(
      asRole(clinician, 'tunisia_doctor', (c) =>
        insertInvitation(c, orgId, owner, 'assistant'),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('sees the invitations it sent, and not the organisation’s others', async () => {
    const { orgId, owner, clinician } = await hospital();
    await asRole(owner, 'tunisia_doctor', (c) => insertInvitation(c, orgId, owner, 'member'), true);
    await asRole(
      clinician,
      'tunisia_doctor',
      (c) => insertInvitation(c, orgId, clinician, 'assistant'),
      true,
    );

    const seen = await asRole(clinician, 'tunisia_doctor', async (c) =>
      (await c.query<{ seat_role: string }>('SELECT seat_role FROM identity_invitations')).rows,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.seat_role).toBe('assistant');
  });
});

describe('reading the clinicians of an organisation', () => {
  it('returns colleagues with their specialty', async () => {
    const { orgId, owner, clinician } = await hospital();
    await h.owner.query(
      `UPDATE identity_memberships SET specialty = 'Radiology'
       WHERE organisation_id = $1 AND user_id = $2`,
      [orgId, clinician],
    );

    const rows = await asRole(owner, 'tunisia_doctor', async (c) =>
      (
        await c.query<{ user_id: string; specialty: string | null }>(
          'SELECT * FROM identity_organisation_clinicians($1)',
          [orgId],
        )
      ).rows,
    );

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.user_id === clinician)?.specialty).toBe('Radiology');
  });

  it('exposes no licence number or verification decision', async () => {
    // The reason this is a function and not a policy on identity_doctor_profiles.
    const { orgId, owner } = await hospital();
    const rows = await asRole(owner, 'tunisia_doctor', async (c) =>
      (await c.query('SELECT * FROM identity_organisation_clinicians($1)', [orgId])).rows,
    );
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      'full_name',
      'role',
      'specialty',
      'user_id',
    ]);
  });

  it('tells an outsider nothing', async () => {
    const { orgId } = await hospital();
    const outsider = await createUser(h.owner, 'tunisia_doctor');
    const rows = await asRole(outsider, 'tunisia_doctor', async (c) =>
      (await c.query('SELECT * FROM identity_organisation_clinicians($1)', [orgId])).rows,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('recording a specialty', () => {
  it('writes it on the membership', async () => {
    const { orgId, clinician } = await hospital();
    await asRole(
      clinician,
      'tunisia_doctor',
      (c) =>
        c.query('SELECT identity_set_membership_specialty($1, $2, $3)', [
          orgId,
          clinician,
          '  Radiology  ',
        ]),
      true,
    );
    const rows = await h.owner.query<{ specialty: string }>(
      'SELECT specialty FROM identity_memberships WHERE user_id = $1',
      [clinician],
    );
    expect(rows.rows[0]?.specialty).toBe('Radiology');
  });

  it('leaves the licensure record completely alone', async () => {
    // THE POINT OF PUTTING IT ON THE MEMBERSHIP. `identity_doctor_profiles`
    // requires a licence number and carries `verified_at`, which is the ops
    // decision `SchedulingService.listDoctors` filters on. If a hospital naming
    // a department could write there, a hospital could manufacture a clinician
    // who looks verified.
    const { orgId, clinician } = await hospital();
    await asRole(
      clinician,
      'tunisia_doctor',
      (c) =>
        c.query('SELECT identity_set_membership_specialty($1, $2, $3)', [
          orgId,
          clinician,
          'Cardiology',
        ]),
      true,
    );
    const profiles = await h.owner.query('SELECT * FROM identity_doctor_profiles');
    expect(profiles.rowCount).toBe(0);
  });

  it('ignores a blank specialty rather than erasing one', async () => {
    const { orgId, clinician } = await hospital();
    await h.owner.query(
      `UPDATE identity_memberships SET specialty = 'Neurology'
       WHERE organisation_id = $1 AND user_id = $2`,
      [orgId, clinician],
    );
    await asRole(
      clinician,
      'tunisia_doctor',
      (c) =>
        c.query('SELECT identity_set_membership_specialty($1, $2, $3)', [orgId, clinician, '   ']),
      true,
    );
    const rows = await h.owner.query<{ specialty: string }>(
      'SELECT specialty FROM identity_memberships WHERE user_id = $1',
      [clinician],
    );
    expect(rows.rows[0]?.specialty).toBe('Neurology');
  });
});

describe('invitation details', () => {
  it('are readable while the invitation stands and gone once consumed', async () => {
    const { orgId, owner } = await hospital();
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    await h.owner.query(
      `INSERT INTO identity_invitations
         (organisation_id, email, token_hash, seat_role, invited_by, expires_at, specialty)
       VALUES ($1, $2, $3, 'member', $4, now() + interval '14 days', 'Neurology')`,
      [orgId, uniqueEmail(), hash, owner],
    );

    const before = await asRole(owner, 'tunisia_doctor', async (c) =>
      (await c.query('SELECT * FROM identity_invitation_details($1)', [hash])).rows,
    );
    expect(before[0]).toMatchObject({ seat_role: 'member', specialty: 'Neurology' });

    await h.owner.query('UPDATE identity_invitations SET consumed_at = now()');

    const after = await asRole(owner, 'tunisia_doctor', async (c) =>
      (await c.query('SELECT * FROM identity_invitation_details($1)', [hash])).rows,
    );
    expect(after).toHaveLength(0);
  });
});

describe('how a refused invitation is reported', () => {
  /**
   * A REFUSED WRITE MUST NOT BE A 500. This is the third time the same shape of
   * bug has appeared in this work — RLS correctly refuses, the raw 42501
   * escapes, and the caller gets "Internal Server Error" for something the
   * system decided on purpose.
   *
   * 403 here rather than the 404 used elsewhere: the caller is a member of this
   * organisation and can see it on screen, so nothing is disclosed by admitting
   * it exists. What they are refused is an ACTION — issuing a seat that becomes
   * a clinical role — and "not found" for a visible organisation is a lie that
   * helps nobody diagnose it.
   */
  it('answers 403 when a clinician tries to issue a clinical seat', async () => {
    const { orgId, clinician } = await hospital();

    const db = new DatabaseService({
      DATABASE_URL: appUrl(),
      DATABASE_POOL_MAX: 4,
    } as AppConfig);
    // The Keycloak stub's type is taken from the constructor rather than by
    // importing identity's internal class — a cross-module `internal/` import
    // is a boundary violation (.dependency-cruiser.cjs), and the rule is right:
    // a test reaching into another module's internals is how those internals
    // stop being free to change.
    type KeycloakParam = ConstructorParameters<typeof OrganisationsService>[1];

    const service = new OrganisationsService(
      db,
      { isConfigured: () => false } as unknown as KeycloakParam,
      { send: () => Promise.resolve() } as unknown as MailSender,
      { APP_PUBLIC_URL: 'http://localhost:3001' } as AppConfig,
    );

    try {
      await expect(
        runWithContext(
          {
            userId: clinician,
            role: 'tunisia_doctor',
            triageBeforePayment: false,
            ipAddress: '41.208.1.5',
            userAgent: 'vitest',
            requestId: 'provisioning',
          },
          () => service.invite(orgId, 'smuggled@example.test', 'member', { specialty: 'X' }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    } finally {
      await db.onModuleDestroy();
    }
  });
});
