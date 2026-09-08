import '../pg-types';
import { createHash } from 'node:crypto';
import { Client, Pool } from 'pg';
import { join } from 'node:path';
import type { Role } from '@mir/contracts';
import { migrateUp } from '../migrator';

/**
 * Test harness for the P3.2 row-level-security gate.
 *
 * The whole point of these tests is that they run against a role with the same
 * privileges the application has in production. Two connections are therefore
 * kept strictly separate:
 *
 *   owner  — superuser. Seeds fixtures. Bypasses RLS, which is exactly why it
 *            must never be used to make an assertion about visibility.
 *   app    — `mir_app`. Non-superuser, non-owner, NOBYPASSRLS. Every assertion
 *            runs here.
 *
 * Using the owner connection to assert "the doctor cannot see this row" would
 * pass no matter how broken the policies were.
 */

const HOST = process.env['TEST_PG_HOST'] ?? '127.0.0.1';
const PORT = process.env['TEST_PG_PORT'] ?? '5433';
const SUPERUSER = process.env['TEST_PG_SUPERUSER'] ?? 'postgres';
const SUPERPASS = process.env['TEST_PG_SUPERPASS'] ?? 'postgres';
/**
 * One database per test WORKER, namespaced by process id.
 *
 * Two levels of collision are possible and both have bitten:
 *
 *  1. Within one Vitest process, test files run in parallel workers and every
 *     DB suite truncates in beforeEach — so a shared database means suite A
 *     wipes suite B's fixtures mid-test. The failures look like real
 *     authorization bugs (foreign key violations, "not found" on a row that
 *     was just created) and they move around between runs.
 *
 *  2. `pnpm -r test` starts a SEPARATE Vitest process per workspace package,
 *     and each numbers its workers from 1. Worker-id alone therefore collides
 *     across processes, which is how an upload test failed once inside
 *     `pnpm verify` while passing every time on its own.
 *
 * Including the process id closes the second. Stale databases are dropped by
 * `pnpm db:clean`.
 */
const WORKER_ID = process.env['VITEST_WORKER_ID'] ?? '1';
const TEST_DB =
  process.env['TEST_PG_DATABASE'] ?? `mir_test_${process.pid}_${WORKER_ID}`;

/** Local test-only credential. Never used outside the test database. */
const APP_PASSWORD = process.env['TEST_PG_APP_PASSWORD'] ?? 'mir_app_test_pw';

/**
 * Baseline published consent terms (P5.3). Must match the hashing used by
 * ConsentService — line endings normalised, nothing else.
 */
const BASELINE_TERMS = {
  ar: 'أوافق على نقل صوري الطبية إلى الطبيب المستقبل في تونس.',
  fr: "J'accepte le transfert de mes images médicales au médecin destinataire en Tunisie.",
} as const;

const sha256Hex = (text: string): string =>
  createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');

export const ownerUrl = (db: string): string =>
  `postgres://${SUPERUSER}:${SUPERPASS}@${HOST}:${PORT}/${db}`;

export const appUrl = (db: string = TEST_DB): string =>
  `postgres://mir_app:${APP_PASSWORD}@${HOST}:${PORT}/${db}`;

export interface Harness {
  owner: Pool;
  app: Pool;
  close: () => Promise<void>;
}

export interface HarnessOptions {
  /**
   * Size of the `mir_app` pool.
   *
   * Two by default, deliberately: a dozen suites run concurrently, each with
   * its own database but all against one PostgreSQL, and its connection budget
   * is shared. Suites that exercise CONCURRENCY rather than authorization need
   * more — with a pool of two, fifty "simultaneous" bookings are not
   * simultaneous at all, they are a queue of fifty behind two connections.
   */
  appPoolMax?: number;
}

/**
 * Cluster-wide mutex key for setup.
 *
 * Advisory locks are scoped to a DATABASE, so this lock is taken on the shared
 * `postgres` maintenance database — the one every worker connects to anyway —
 * and it therefore serialises workers that are otherwise each in their own
 * test database. The arbitrary constant just has to be the same everywhere.
 */
const SETUP_LOCK_KEY = 8_147_221_930;

/**
 * Drop test databases whose owning process is gone.
 *
 * Test databases are named `mir_test_<pid>_<worker>` and deliberately OUTLIVE
 * the run: files in one worker share a database, so dropping at teardown would
 * force a CREATE DATABASE and a full migration for every test file.
 *
 * The cost of never dropping them is not zero, though. They accumulate — 160
 * of them after a couple of afternoons — and on a slow filesystem the cluster
 * gets slow enough that an unrelated test times out. That surfaced once as the
 * P10.2 booking-concurrency gate failing at 30 s, which reads as "the
 * double-booking guarantee broke" and is nothing of the sort. A gate that
 * fails for a reason unrelated to what it tests is worse than no gate.
 *
 * So: reap the ones whose creating process no longer exists.
 *
 * Deliberately NOT `pnpm db:clean`, which drops every mir_test_* database and
 * terminates its backends. That is correct as a manual command and unsafe as
 * an automatic one — two concurrent runs would destroy each other, which is
 * exactly how this problem was first noticed.
 *
 * `process.kill(pid, 0)` sends no signal; it only asks whether the pid is
 * addressable. A recycled pid makes this skip a database that could have been
 * dropped, which is the safe direction to be wrong in.
 */
async function reapAbandonedTestDatabases(admin: Client): Promise<void> {
  const { rows } = await admin.query<{ datname: string }>(
    // Doubled backslashes: a template literal collapses `\_` to `_`, which
    // would send Postgres an EMPTY escape clause and turn the underscores into
    // wildcards — a broader match than intended.
    `SELECT datname FROM pg_database WHERE datname LIKE 'mir\\_test\\_%' ESCAPE '\\'`,
  );

  for (const { datname } of rows) {
    const pid = Number(datname.split('_')[2]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (pid === process.pid) continue;

    try {
      process.kill(pid, 0);
      continue; // owner still running — leave it alone
    } catch (err) {
      // EPERM means the process exists but belongs to another user. Still
      // alive, so still not ours to drop.
      if ((err as NodeJS.ErrnoException).code === 'EPERM') continue;
    }

    try {
      await admin.query(`DROP DATABASE IF EXISTS ${JSON.stringify(datname).replace(/"/g, '"')}`);
    } catch {
      // A database in use by a connection we cannot see, or dropped by another
      // worker between the SELECT and here. Neither is worth failing setup
      // over: this is housekeeping, not a test assertion.
    }
  }
}

/**
 * Create (or recreate) the test database, apply migrations, and give the
 * application role a login for the duration of the test run.
 */
export async function setupTestDatabase(options: HarnessOptions = {}): Promise<Harness> {
  const appPoolMax = options.appPoolMax ?? 2;

  /**
   * SETUP IS SERIALISED ACROSS WORKERS, AND IT HAS TO BE.
   *
   * Roles live in `pg_authid`, which is a SHARED catalog: one copy for the
   * whole cluster, not one per database. Migration 0002 re-asserts mir_app's
   * safety attributes with ALTER ROLE, and the login password is attached
   * below with another ALTER ROLE. Both write the same catalog tuple.
   *
   * PostgreSQL does not queue concurrent writers of a shared-catalog tuple —
   * it aborts one with `tuple concurrently updated`. With four workers each
   * migrating their own database at the same moment, that is a routine race,
   * and it surfaced as three whole suites failing in setup with an error that
   * looks nothing like its cause.
   *
   * The lock is held across CREATE DATABASE, the migrations and the ALTER
   * ROLE. Only setup is serialised; the tests themselves still run fully in
   * parallel.
   */
  const admin = new Client({ connectionString: ownerUrl('postgres') });
  await admin.connect();
  const owner = await (async (): Promise<Pool> => {
    await admin.query('SELECT pg_advisory_lock($1)', [SETUP_LOCK_KEY]);
    try {
      await reapAbandonedTestDatabases(admin);

      const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
      if (exists.rowCount === 0) {
        // Identifier cannot be parameterised; TEST_DB is not user input.
        await admin.query(`CREATE DATABASE ${JSON.stringify(TEST_DB).replace(/"/g, '"')}`);
      }

      // --- migrate ---------------------------------------------------------
      const migrationsDir = join(process.cwd(), 'migrations');
      await migrateUp(ownerUrl(TEST_DB), migrationsDir);

      // --- give mir_app a login for testing --------------------------------
      // The migration deliberately creates the role NOLOGIN with no password,
      // so no credential is committed (§6). Attaching one is an environment
      // concern: Terraform + Secrets Manager in deployed environments, here in
      // tests.
      const pool = new Pool({ connectionString: ownerUrl(TEST_DB), max: 2 });
      await pool.query(`ALTER ROLE mir_app LOGIN PASSWORD '${APP_PASSWORD}'`);
      return pool;
    } finally {
      // Released even if setup failed, or every other worker hangs behind a
      // lock that will never be freed until the connection closes.
      await admin.query('SELECT pg_advisory_unlock($1)', [SETUP_LOCK_KEY]);
      await admin.end();
    }
  })();

  // Baseline reference data: consent_records carries a foreign key to
  // consent_terms (0003), so every suite that grants consent needs published
  // terms to exist. Seeded here rather than per-suite so the suites stay
  // independently runnable in any order.
  await owner.query(
    `INSERT INTO consent_terms (version, locale, scope, body, content_hash, published_at)
     VALUES
       ('v1', 'ar', 'cross_border_transfer', $1, $2, now()),
       ('v1', 'fr', 'cross_border_transfer', $3, $4, now())
     ON CONFLICT DO NOTHING`,
    [
      BASELINE_TERMS.ar,
      sha256Hex(BASELINE_TERMS.ar),
      BASELINE_TERMS.fr,
      sha256Hex(BASELINE_TERMS.fr),
    ],
  );

  const app = new Pool({ connectionString: appUrl(TEST_DB), max: appPoolMax });

  return {
    owner,
    app,
    close: async () => {
      await app.end();
      await owner.end();
    },
  };
}

export interface SessionContext {
  userId: string;
  role: Role;
}

/**
 * Run a callback inside a transaction with the RLS session context set.
 *
 * `set_config(..., true)` is the parameterised equivalent of `SET LOCAL`: the
 * value is scoped to this transaction and reverts on commit or rollback. Using
 * SET LOCAL with string interpolation instead would be an injection vector on
 * the one value an attacker most wants to control — their own user id.
 *
 * The context is set INSIDE the transaction on purpose (P4.2). Setting it
 * outside has no effect on the transaction's queries and silently disables
 * every policy's identity check.
 */
export async function asUser<T>(
  pool: Pool,
  ctx: SessionContext,
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', ctx.userId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.user_role', ctx.role]);
    const result = await fn(client);
    await client.query('ROLLBACK');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Remove all data between tests, as the owner (bypasses RLS). */
export async function truncateAll(owner: Pool): Promise<void> {
  await owner.query(`
    TRUNCATE
      audit_events,
      identity_invitations,
      identity_memberships,
      identity_organisations,
      cases_case_studies,
      cases_cases,
      imaging_instances,
      imaging_studies,
      consent_records,
      patients_patients,
      identity_doctor_profiles,
      identity_users
    RESTART IDENTITY CASCADE
  `);
}

// ---------------------------------------------------------------------------
// Fixture builders. All seeding happens on the owner connection.
// ---------------------------------------------------------------------------

let seq = 0;
const uniq = (): string => `${Date.now()}-${++seq}`;

export async function createUser(
  owner: Pool,
  role: Role,
  overrides: { fullName?: string; status?: string } = {},
): Promise<string> {
  const n = uniq();
  const res = await owner.query<{ id: string }>(
    `INSERT INTO identity_users (keycloak_sub, role, phone_e164, full_name, status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      `sub-${n}`,
      role,
      `+2189${n.replace(/\D/g, '').slice(-9).padStart(9, '0')}`,
      overrides.fullName ?? `Test ${role} ${n}`,
      overrides.status ?? 'active',
    ],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('createUser returned no row');
  return row.id;
}

export async function createPatient(
  owner: Pool,
  createdByDoctor: string,
  overrides: { dateOfBirth?: string; sex?: 'M' | 'F' | 'O' } = {},
): Promise<string> {
  const n = uniq();
  const res = await owner.query<{ id: string }>(
    `INSERT INTO patients_patients
       (phone_e164, full_name, date_of_birth, sex, created_by_doctor)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      `+2189${n.replace(/\D/g, '').slice(-9)}`,
      `Patient ${n}`,
      overrides.dateOfBirth ?? '1985-06-15',
      overrides.sex ?? 'M',
      createdByDoctor,
    ],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('createPatient returned no row');
  return row.id;
}

export async function createStudy(
  owner: Pool,
  patientId: string,
  uploadedBy: string,
  overrides: { status?: string; modality?: string; twinStudyUid?: string } = {},
): Promise<string> {
  const n = uniq();
  const digits = n.replace(/\D/g, '');
  const res = await owner.query<{ id: string }>(
    `INSERT INTO imaging_studies
       (patient_id, uploaded_by, study_instance_uid, modality, status, twin_study_uid)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      patientId,
      uploadedBy,
      `1.3.6.1.4.1.99999.1.${digits}`,
      overrides.modality ?? 'CT',
      overrides.status ?? 'ready',
      // Default fixture is a RELEASED study, so every pre-existing test keeps
      // its meaning. A twin UID is part of being released.
      overrides.twinStudyUid ?? `1.3.6.1.4.1.99999.2.${digits}`,
    ],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('createStudy returned no row');
  return row.id;
}

export type CaseStatusFixture =
  | 'submitted'
  | 'quoted'
  | 'paid'
  | 'accepted'
  | 'answered'
  | 'closed'
  | 'declined'
  | 'cancelled'
  | 'expired';

/**
 * The source organisation that owes for this patient's cases.
 *
 * `cases_cases.organisation_id` is NOT NULL (migration 0025) because who owed
 * the money is a fact of the case, not of where the clinician happens to work
 * today. Every fixture therefore needs an organisation, and most tests do not
 * care which — so this resolves the patient's referring doctor's source org and
 * creates one only when there is none. Callers that DO care pass their own.
 */
async function sourceOrganisationFor(owner: Pool, patientId: string): Promise<string> {
  const found = await owner.query<{ id: string }>(
    `SELECT o.id
       FROM patients_patients p
       JOIN identity_memberships m   ON m.user_id = p.created_by_doctor
       JOIN identity_organisations o ON o.id = m.organisation_id AND o.side = 'source'
      WHERE p.id = $1
      LIMIT 1`,
    [patientId],
  );
  const existing = found.rows[0]?.id;
  if (existing !== undefined) return existing;

  const created = await owner.query<{ id: string; doctor: string }>(
    `WITH org AS (
       INSERT INTO identity_organisations
         (kind, legal_name, corridor_id, side, verification_status, decided_at)
       VALUES ('laboratory', $2, 'ly-tn', 'source', 'approved', now())
       RETURNING id
     )
     INSERT INTO identity_memberships (organisation_id, user_id, seat_role)
     SELECT org.id, p.created_by_doctor, 'owner' FROM org, patients_patients p
      WHERE p.id = $1
     RETURNING organisation_id AS id, user_id AS doctor`,
    [patientId, `Lab ${uniq()}`],
  );
  const orgId = created.rows[0]?.id;
  if (orgId === undefined) throw new Error('could not resolve a source organisation');
  return orgId;
}

export async function createCase(
  owner: Pool,
  patientId: string,
  doctorId: string,
  status: CaseStatusFixture = 'accepted',
  opts: { organisationId?: string; specialty?: string } = {},
): Promise<string> {
  const orgId = opts.organisationId ?? (await sourceOrganisationFor(owner, patientId));
  const res = await owner.query<{ id: string }>(
    `INSERT INTO cases_cases (patient_id, doctor_id, status, organisation_id, specialty)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [patientId, doctorId, status, orgId, opts.specialty ?? 'radiology'],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('createCase returned no row');
  return row.id;
}

export async function linkStudy(owner: Pool, caseId: string, studyId: string): Promise<void> {
  await owner.query(`INSERT INTO cases_case_studies (case_id, study_id) VALUES ($1, $2)`, [
    caseId,
    studyId,
  ]);
}

/**
 * Consent is an ATTESTATION by the referring doctor (migration 0021), so the
 * attesting user is required rather than optional. A default would let a test
 * record consent nobody attested, which is the one thing the new model exists
 * to prevent.
 */
export async function grantConsent(
  owner: Pool,
  patientId: string,
  grantedTo: string,
  attestedBy: string,
): Promise<string> {
  const res = await owner.query<{ id: string }>(
    `INSERT INTO consent_records
       (patient_id, scope, granted_to, terms_version, terms_locale, evidence_hash,
        attested_by, document_object_key, document_sha256)
     VALUES ($1, 'cross_border_transfer', $2, 'v1', 'ar', $3, $4, $5, $6) RETURNING id`,
    [patientId, grantedTo, 'a'.repeat(64), attestedBy, `consent/${patientId}.pdf`, 'b'.repeat(64)],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('grantConsent returned no row');
  return row.id;
}

export async function revokeConsent(owner: Pool, consentId: string): Promise<void> {
  await owner.query(`UPDATE consent_records SET revoked_at = now() WHERE id = $1`, [consentId]);
}

/**
 * A practice: one organisation, its doctor, and an assistant seated in it.
 *
 * The organisation must be `approved` — `identity_grant_assistant_role` refuses
 * a pending one, exactly as the clinical grant does, so a fixture that skipped
 * this would be testing a path production cannot reach.
 */
export async function createPractice(
  owner: Pool,
  doctorRole: Role = 'tunisia_doctor',
): Promise<{ orgId: string; doctorId: string; assistantId: string }> {
  const n = uniq();
  const doctorId = await createUser(owner, doctorRole);
  const assistantId = await createUser(owner, 'assistant');

  const org = await owner.query<{ id: string }>(
    `INSERT INTO identity_organisations
       (kind, legal_name, corridor_id, side, verification_status, decided_at)
     VALUES ('clinic', $1, 'ly-tn', $2, 'approved', now()) RETURNING id`,
    [`Clinic ${n}`, doctorRole === 'libya_doctor' ? 'source' : 'destination'],
  );
  const orgId = org.rows[0]?.id;
  if (orgId === undefined) throw new Error('createPractice returned no organisation');

  await owner.query(
    `INSERT INTO identity_memberships (organisation_id, user_id, seat_role)
     VALUES ($1, $2, 'owner'), ($1, $3, 'assistant')`,
    [orgId, doctorId, assistantId],
  );

  return { orgId, doctorId, assistantId };
}

/** Seat an existing user in an organisation. */
export async function seatMember(
  owner: Pool,
  orgId: string,
  userId: string,
  seatRole: 'owner' | 'member' | 'assistant' = 'member',
): Promise<void> {
  await owner.query(
    `INSERT INTO identity_memberships (organisation_id, user_id, seat_role) VALUES ($1, $2, $3)`,
    [orgId, userId, seatRole],
  );
}

/**
 * A destination doctor with a specialty, a tier and an availability switch.
 *
 * Everything `pricing_accepting_count` filters on has to be here or the doctor
 * is invisible to the count for a reason unrelated to what the test is about:
 * an APPROVED organisation, on the corridor, on the DESTINATION side, and a
 * membership joining the two. Seeding only the profile row produces a doctor
 * who is accepting work and counts for nothing, which reads as a broken
 * formula.
 */
export async function seedDoctor(
  owner: Pool,
  options: {
    specialty: string;
    tier?: 'standard' | 'senior' | 'expert';
    accepting?: boolean;
    corridorId?: string;
    /**
     * Verified by default. Set false to seed a doctor the directory and the
     * surge count must both refuse to see — an unverified doctor may not
     * receive imaging, so quoting against one would price an unusable pick.
     */
    verified?: boolean;
  },
): Promise<string> {
  const n = uniq();
  const doctorId = await createUser(owner, 'tunisia_doctor');

  const org = await owner.query<{ id: string }>(
    `INSERT INTO identity_organisations
       (kind, legal_name, corridor_id, side, verification_status, decided_at)
     VALUES ('clinic', $1, $2, 'destination', 'approved', now()) RETURNING id`,
    [`Practice ${n}`, options.corridorId ?? 'ly-tn'],
  );
  const orgId = org.rows[0]?.id;
  if (orgId === undefined) throw new Error('seedDoctor returned no organisation');

  await owner.query(
    `INSERT INTO identity_memberships (organisation_id, user_id, seat_role)
     VALUES ($1, $2, 'owner')`,
    [orgId, doctorId],
  );

  await owner.query(
    `INSERT INTO identity_doctor_profiles
       (user_id, country, license_number, specialty, accepting_cases, tier_code, verified_at)
     VALUES ($1, 'TN', $2, $3, $4, $5, CASE WHEN $6::boolean THEN now() END)`,
    [
      doctorId,
      `TN-${n}`,
      options.specialty,
      options.accepting ?? false,
      options.tier ?? 'standard',
      options.verified ?? true,
    ],
  );

  return doctorId;
}

/** `count` doctors of one specialty, all accepting, all on the base tier. */
export async function seedAcceptingDoctors(
  owner: Pool,
  options: { specialty: string; count: number; corridorId?: string },
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < options.count; i += 1) {
    ids.push(
      await seedDoctor(owner, {
        specialty: options.specialty,
        accepting: true,
        ...(options.corridorId === undefined ? {} : { corridorId: options.corridorId }),
      }),
    );
  }
  return ids;
}
