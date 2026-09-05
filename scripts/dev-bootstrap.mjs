#!/usr/bin/env node
/**
 * Make a local checkout signable-into, with enough data to see the screens.
 *
 * WHY THIS EXISTS. Three things stand between `docker compose up` and a usable
 * local app, and none of them is done for you:
 *
 *   1. The realm imports with `sslRequired: all`, so every token request over
 *      plain HTTP is refused with "HTTPS required" — which reads like a broken
 *      login rather than a policy.
 *   2. `mir-web` ships with direct access grants OFF and the realm with
 *      `loginWithEmailAllowed` false, so the email + password form cannot work
 *      even once TLS is out of the way.
 *   3. `identity.service.ts` looks the caller up by `id = <token sub>`. With no
 *      matching row a perfectly valid token yields 404 "User record not found",
 *      and the app renders as though nobody is signed in.
 *
 * Each fails differently and only the third looks like an auth problem, so the
 * usual outcome is an hour of debugging the wrong layer. This script does all
 * three, then seeds enough domain data that the dashboards show something.
 *
 * ⚠ DEVELOPMENT ONLY, AND IT REFUSES TO BE ANYTHING ELSE. It weakens the realm
 * (TLS off) and installs a hardcoded `amr=otp` mapper, which makes every
 * password-grant token CLAIM a second factor — `token-verifier.ts` trusts that
 * claim for clinical roles (P4.3). On a real realm that is a bypass of the MFA
 * gate. The guards below refuse any non-loopback target for exactly that reason.
 *
 * Run:  node scripts/dev-bootstrap.mjs
 * Needs: docker compose up, and migrations applied (pnpm --filter @mir/api migrate:up)
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromApi = createRequire(join(REPO, 'apps', 'api', 'package.json'));

const KC = process.env['KC_SERVER'] ?? 'http://localhost:8081';
const REALM = process.env['KC_REALM'] ?? 'mir';
const ADMIN_USER = process.env['KC_ADMIN_USER'] ?? 'admin';
const ADMIN_PASSWORD = process.env['KC_ADMIN_PASSWORD'] ?? 'admin';
/**
 * How to reach Postgres.
 *
 * TWO PATHS, because compose does not always publish the port. `mir-postgres`
 * runs on the compose network and a container recreated from an older file may
 * expose nothing to the host — in which case a host-side connection string
 * either fails or, far worse, silently reaches a DIFFERENT postgres that
 * happens to hold port 5433. That is not hypothetical: it is how this script's
 * first run seeded a stale database while the application read an empty one,
 * and nothing about the symptom pointed at the cause.
 *
 * So the default is `docker exec` into the container the application itself
 * talks to — there is exactly one such database and no ambiguity about which.
 * Set DATABASE_MIGRATOR_URL to use a direct connection instead.
 */
const DB_CONTAINER = process.env['DEV_DB_CONTAINER'] ?? 'mir-postgres';
const DB_NAME = process.env['DEV_DB_NAME'] ?? 'mir';
const DB_URL = process.env['DATABASE_MIGRATOR_URL'] ?? null;

/**
 * Loopback only, on both targets.
 *
 * Checked as a HOSTNAME rather than by substring: "localhost.evil.test" and
 * "http://evil.test/#localhost" both contain the word.
 */
function assertLocal(label, urlish) {
  const host = new URL(urlish.startsWith('postgres') ? urlish.replace(/^postgres(ql)?:/, 'http:') : urlish)
    .hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    console.error(
      `refusing to run: ${label} points at "${host}", not loopback.\n` +
        'This script disables TLS enforcement and installs an MFA-bypassing\n' +
        'token mapper. It must never touch a shared or deployed realm.',
    );
    process.exit(1);
  }
}

// Realm passwordPolicy requires >= 12 characters.
const ACCOUNTS = [
  { username: 'dev-doctor@example.test',    role: 'libya_doctor',    name: 'Dr Amal Referring',  phone: '+218911000001', password: 'dev-doctor-pass-1234' },
  { username: 'dev-receiver@example.test',  role: 'tunisia_doctor',  name: 'Dr Karim Receiving', phone: '+216711000002', password: 'dev-receiver-pass-1234' },
  { username: 'dev-patient@example.test',   role: 'patient',         name: 'Sample Patient',     phone: '+218911000003', password: 'dev-patient-pass-1234' },
  { username: 'dev-ops@example.test',       role: 'admin',           name: 'Ops Staff',          phone: '+216711000004', password: 'dev-ops-pass-1234' },
  { username: 'dev-applicant@example.test', role: 'applicant',       name: 'Dr Pending Applicant', phone: '+218911000005', password: 'dev-applicant-pass-1234' },
  { username: 'dev-assistant@example.test', role: 'assistant',       name: 'Salma Reception',    phone: '+216711000006', password: 'dev-assist-pass-1234' },
  { username: 'dev-radiologist@example.test', role: 'tunisia_doctor', name: 'Dr Nadia Radiology', phone: '+216711000007', password: 'dev-radio-pass-1234' },
  { username: 'dev-cardio@example.test',    role: 'tunisia_doctor',  name: 'Dr Sami Cardiology', phone: '+216711000008', password: 'dev-cardio-pass-1234' },
];

/**
 * The service-account client that makes /signup work.
 *
 * WHY REGISTRATION NEEDS ONE. Creating an account is an operation ON KEYCLOAK
 * (ADR-2): the password never exists on the API's side of the boundary. So the
 * API needs a client that may create users, and with no such credential
 * `KeycloakAdminClient.isConfigured()` is false and /auth/register answers 501
 * — "self-registration is not enabled in this environment", which is the
 * honest refusal and not a bug.
 *
 * THE SECRET IS A FIXED STRING, ON PURPOSE. Keycloak here has no data volume,
 * so every recreate would otherwise mint a new secret and silently invalidate
 * the one in .env — the same orphaning problem `stableUuid` solves for subs.
 * It is written into a gitignored .env, and this script already refuses any
 * non-loopback realm.
 */
const ADMIN_CLIENT = {
  clientId: 'mir-api-admin',
  secret: 'dev-only-admin-secret-do-not-deploy',
  /**
   * `manage-users` covers create, enable and delete. `view-realm` is what lets
   * the role lookup in `assignRealmRole` read a realm role before mapping it —
   * approving a provider fails at that lookup without it.
   */
  roles: ['manage-users', 'view-users', 'query-users', 'view-realm'],
};

/**
 * SYNTHETIC PATIENTS ONLY (ADR-7). Invented names, invented numbers. Nothing
 * here may ever be derived from a real record, and `pnpm check:synthetic`
 * exists because that rule is easy to break by accident.
 */
const PATIENTS = [
  { name: 'Sample Patient',       phone: '+218911000003', dob: '1985-04-12', sex: 'F', claim: true },
  { name: 'Test Case Alpha',      phone: '+218911000011', dob: '1971-11-03', sex: 'M', claim: false },
  { name: 'Test Case Beta',       phone: '+218911000012', dob: '1994-06-27', sex: 'F', claim: false },
  { name: 'Synthetic Record Three', phone: '+218911000013', dob: '2002-01-19', sex: 'M', claim: false },
];

/**
 * A stable id for a dev account, derived from its username.
 *
 * WHY NOT LET KEYCLOAK ALLOCATE ONE. Keycloak here has no data volume, so any
 * `docker compose up` that recreates it wipes every user — and the next run of
 * this script creates them again with BRAND NEW subs. The `identity_users` rows
 * seeded against the previous generation are then orphaned: their ids match no
 * token, `/auth/me` answers 404, and the app renders every account as signed
 * out while the database looks perfectly populated.
 *
 * Deriving the id from the username removes the whole failure mode. Keycloak
 * accepts an explicit `id` on create, so the same account is the same subject
 * across as many recreates as you like.
 *
 * A v5-shaped UUID: SHA-1 of a fixed namespace plus the name, with the version
 * and variant bits set per RFC 4122. The namespace is arbitrary and local to
 * this script — it only has to be stable.
 */
function stableUuid(name) {
  const h = createHash('sha1').update(`mir-dev-bootstrap:${name}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let adminToken = null;

async function kcAdmin(path, init = {}) {
  if (adminToken === null) {
    const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: ADMIN_USER,
        password: ADMIN_PASSWORD,
      }),
    });
    if (!res.ok) throw new Error(`Keycloak admin login failed: ${res.status}`);
    adminToken = (await res.json()).access_token;
  }
  const res = await fetch(`${KC}/admin/realms${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
    },
  });
  return res;
}

async function configureRealm() {
  const current = await (await kcAdmin(`/${REALM}`)).json();
  const res = await kcAdmin(`/${REALM}`, {
    method: 'PUT',
    body: JSON.stringify({
      ...current,
      // The two settings that make plain-HTTP email+password login possible.
      sslRequired: 'none',
      loginWithEmailAllowed: true,
    }),
  });
  if (!res.ok) throw new Error(`realm update failed: ${res.status}`);
  console.log('  realm      sslRequired=none, loginWithEmailAllowed=true');
}

/**
 * `applicant` is absent from realm-mir.json's role list because it did not
 * exist when that export was written. Sign-up assigns it, and the auth guard
 * reads the role from the TOKEN — so without the realm role a freshly
 * registered account authenticates as nobody.
 */
async function ensureRoles() {
  for (const name of ['libya_doctor', 'tunisia_doctor', 'patient', 'admin', 'applicant', 'assistant']) {
    const found = await kcAdmin(`/${REALM}/roles/${encodeURIComponent(name)}`);
    if (found.ok) continue;
    const res = await kcAdmin(`/${REALM}/roles`, {
      method: 'POST',
      body: JSON.stringify({ name, description: `MIR ${name}` }),
    });
    if (!res.ok && res.status !== 409) throw new Error(`role ${name} failed: ${res.status}`);
    console.log(`  role       created ${name}`);
  }
}

async function configureWebClient() {
  const clients = await (await kcAdmin(`/${REALM}/clients?clientId=mir-web`)).json();
  const client = clients[0];
  if (client === undefined) throw new Error('mir-web client not found — is the realm imported?');

  if (client.directAccessGrantsEnabled !== true) {
    const res = await kcAdmin(`/${REALM}/clients/${client.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...client, directAccessGrantsEnabled: true }),
    });
    if (!res.ok) throw new Error(`mir-web update failed: ${res.status}`);
  }
  console.log('  mir-web    directAccessGrants=true');

  /*
   * THE MFA SHORTCUT, AND WHY IT IS HERE.
   *
   * `token-verifier.ts` refuses a clinical role whose token carries no `amr`
   * claim (P4.3). A direct-grant request cannot run an OTP challenge, so
   * without this mapper a doctor account can only sign in through the browser
   * redirect — which needs TOTP enrolment before it will complete.
   *
   * Hardcoding amr=["otp"] makes every password-grant token claim a factor it
   * never presented. That is a REAL MFA bypass and it is why this script
   * refuses non-loopback targets. It must never exist on a shared realm.
   *
   * Created with a JSON body: `-s 'config."claim.name"=amr'` via kcadm fails
   * SILENTLY for protocol mappers, leaving a mapper that emits nothing.
   */
  const mappers = await (await kcAdmin(`/${REALM}/clients/${client.id}/protocol-mappers/models`)).json();
  if (mappers.some((m) => m.name === 'dev-amr-otp')) {
    console.log('  mir-web    amr mapper already present');
    return;
  }
  const res = await kcAdmin(`/${REALM}/clients/${client.id}/protocol-mappers/models`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'dev-amr-otp',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-hardcoded-claim-mapper',
      config: {
        'claim.name': 'amr',
        'claim.value': '["otp"]',
        'jsonType.label': 'JSON',
        'id.token.claim': 'true',
        'access.token.claim': 'true',
      },
    }),
  });
  if (!res.ok && res.status !== 409) throw new Error(`amr mapper failed: ${res.status}`);
  console.log('  mir-web    amr mapper installed (DEV ONLY — see the note in this script)');
}

/**
 * Creates the confidential client the API registers users with, and grants its
 * service account the narrow set of realm-management roles that needs.
 *
 * Idempotent in both directions: an existing client has its secret reset to the
 * known value, because a client created by an earlier run of a different script
 * holds a secret nothing else knows.
 */
async function ensureAdminClient() {
  const existing = await (
    await kcAdmin(`/${REALM}/clients?clientId=${encodeURIComponent(ADMIN_CLIENT.clientId)}`)
  ).json();

  const definition = {
    clientId: ADMIN_CLIENT.clientId,
    secret: ADMIN_CLIENT.secret,
    protocol: 'openid-connect',
    publicClient: false,
    serviceAccountsEnabled: true,
    // It is a machine credential and nothing else: no browser flow, no
    // password grant, no user ever logs in through it.
    standardFlowEnabled: false,
    directAccessGrantsEnabled: false,
    implicitFlowEnabled: false,
  };

  let id;
  if (existing.length > 0) {
    id = existing[0].id;
    const res = await kcAdmin(`/${REALM}/clients/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...existing[0], ...definition }),
    });
    if (!res.ok) throw new Error(`${ADMIN_CLIENT.clientId} update failed: ${res.status}`);
  } else {
    const res = await kcAdmin(`/${REALM}/clients`, {
      method: 'POST',
      body: JSON.stringify(definition),
    });
    if (!res.ok) throw new Error(`${ADMIN_CLIENT.clientId} create failed: ${res.status}`);
    id = res.headers.get('location').split('/').pop();
  }

  // The service account is a user like any other; the roles it needs live on
  // the built-in `realm-management` client, not on the realm.
  const account = await (await kcAdmin(`/${REALM}/clients/${id}/service-account-user`)).json();
  const mgmt = (await (await kcAdmin(`/${REALM}/clients?clientId=realm-management`)).json())[0];
  if (mgmt === undefined) throw new Error('realm-management client not found');

  const available = await (
    await kcAdmin(`/${REALM}/users/${account.id}/role-mappings/clients/${mgmt.id}/available`)
  ).json();
  const wanted = available.filter((r) => ADMIN_CLIENT.roles.includes(r.name));

  if (wanted.length > 0) {
    const res = await kcAdmin(`/${REALM}/users/${account.id}/role-mappings/clients/${mgmt.id}`, {
      method: 'POST',
      body: JSON.stringify(wanted.map((r) => ({ id: r.id, name: r.name }))),
    });
    if (!res.ok) throw new Error(`service-account roles failed: ${res.status}`);
  }

  console.log(`  ${ADMIN_CLIENT.clientId} service account + ${ADMIN_CLIENT.roles.join(', ')}`);
}

/** Creates or finds each account, assigns its realm role, and returns the subs. */
async function ensureUsers() {
  const subs = {};
  for (const account of ACCOUNTS) {
    let sub;
    const existing = await (
      await kcAdmin(`/${REALM}/users?username=${encodeURIComponent(account.username)}&exact=true`)
    ).json();

    if (existing.length > 0) {
      sub = existing[0].id;
    } else {
      const res = await kcAdmin(`/${REALM}/users`, {
        method: 'POST',
        body: JSON.stringify({
          // Explicit, so a Keycloak recreate does not orphan the seeded rows.
          id: stableUuid(account.username),
          username: account.username,
          email: account.username,
          firstName: account.name.split(' ')[0],
          lastName: account.name.split(' ').slice(1).join(' '),
          enabled: true,
          emailVerified: true,
          credentials: [{ type: 'password', value: account.password, temporary: false }],
        }),
      });
      if (!res.ok) throw new Error(`user ${account.username} failed: ${res.status}`);
      sub = res.headers.get('location').split('/').pop();
    }

    // Idempotent: re-running must not duplicate the mapping or reset a password
    // someone changed by hand.
    const role = await (await kcAdmin(`/${REALM}/roles/${encodeURIComponent(account.role)}`)).json();
    await kcAdmin(`/${REALM}/users/${sub}/role-mappings/realm`, {
      method: 'POST',
      body: JSON.stringify([{ id: role.id, name: role.name }]),
    });

    subs[account.username] = sub;
    console.log(`  user       ${account.username.padEnd(28)} ${account.role.padEnd(15)} ${sub}`);
  }
  return subs;
}

/** A SQL string literal. Every value here is one this script controls. */
function q(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * The whole seed as ONE idempotent script.
 *
 * No client-side round trips: every row that needs another row's id finds it
 * with a subselect on a natural key (a phone number, a legal name) rather than
 * reading back a RETURNING value. That is what lets the same SQL run through a
 * driver or through `docker exec psql`, and it is why re-running changes
 * nothing — each statement is guarded by NOT EXISTS or ON CONFLICT.
 */
function buildSeedSql(subs) {
  const id = (username) => subs[username];
  const doctor = id('dev-doctor@example.test');
  const receiver = id('dev-receiver@example.test');
  const patientUser = id('dev-patient@example.test');
  const applicant = id('dev-applicant@example.test');
  const ops = id('dev-ops@example.test');
  const assistant = id('dev-assistant@example.test');
  const radiologist = id('dev-radiologist@example.test');
  const cardiologist = id('dev-cardio@example.test');

  const lines = ['BEGIN;'];

  /*
   * Free the unique columns from any PREVIOUS generation of these accounts.
   *
   * `identity_users` is unique on both phone_e164 and lower(email). A run from
   * before ids became deterministic left rows holding those values under subs
   * that no longer exist, and the insert below then fails on a constraint that
   * has nothing to do with what went wrong.
   *
   * Those rows cannot simply be deleted — patients and appointments reference
   * them, and nothing in this schema grants DELETE anyway — so their unique
   * values are parked instead. The row survives with its history intact and
   * stops standing in the way. Scoped to `@example.test` addresses, so it can
   * only ever touch accounts this script created.
   */
  for (const a of ACCOUNTS) {
    lines.push(
      `UPDATE identity_users
       SET phone_e164 = phone_e164 || '.stale.' || left(id::text, 8),
           email = email || '.stale.' || left(id::text, 8)
       WHERE (phone_e164 = ${q(a.phone)} OR lower(email) = lower(${q(a.username)}))
         AND id <> ${q(id(a.username))}::uuid
         AND email LIKE '%@example.test%';`,
    );
  }


  // identity_users.id MUST equal the token's sub — that is the lookup
  // identity.service.ts performs, and the commonest reason a valid token still
  // renders as signed-out.
  for (const a of ACCOUNTS) {
    lines.push(
      `INSERT INTO identity_users (id, keycloak_sub, role, phone_e164, full_name, email, locale, status)
       VALUES (${q(id(a.username))}::uuid, ${q(id(a.username))}, ${q(a.role)}, ${q(a.phone)},
               ${q(a.name)}, ${q(a.username)}, 'ar', 'active')
       ON CONFLICT (id) DO UPDATE
         SET role = EXCLUDED.role, status = 'active', email = EXCLUDED.email;`,
    );
    lines.push(
      `INSERT INTO identity_user_preferences (user_id) VALUES (${q(id(a.username))}::uuid)
       ON CONFLICT (user_id) DO NOTHING;`,
    );
  }

  /*
   * Move everything the PREVIOUS generation of these accounts owned onto the
   * current one.
   *
   * Parking the stale row frees the unique columns, but it leaves every patient,
   * appointment and membership still pointing at a user id no token will ever
   * carry again. The result is the most confusing possible state: sign-in
   * works, the dashboard is empty, and the data is visibly present in the
   * database — it simply belongs to a subject that no longer exists.
   *
   * Re-pointing is safe here precisely because these rows were created by this
   * script. It is scoped through the parked `@example.test` marker, so nothing
   * a human entered can be caught by it.
   */
  const stale = (username) =>
    `(SELECT id FROM identity_users WHERE email LIKE ${q(`${username}.stale.%`)})`;
  for (const a of ACCOUNTS) {
    const to = `${q(id(a.username))}::uuid`;
    const from = stale(a.username);
    lines.push(
      `UPDATE patients_patients SET created_by_doctor = ${to} WHERE created_by_doctor IN ${from};`,
      `UPDATE patients_patients SET claimed_by_user = ${to} WHERE claimed_by_user IN ${from};`,
      `UPDATE scheduling_appointments SET doctor_id = ${to} WHERE doctor_id IN ${from};`,
      `UPDATE scheduling_availability SET doctor_id = ${to} WHERE doctor_id IN ${from};`,
      `UPDATE consent_records SET granted_to = ${to} WHERE granted_to IN ${from};`,
      // Deleted, not re-pointed: (organisation_id, user_id) is the primary key,
      // so moving a stale seat onto a user who already holds one collides. The
      // seat carries nothing worth preserving and the INSERTs below recreate it.
      `DELETE FROM identity_memberships WHERE user_id IN ${from};`,
      `UPDATE audit_events SET actor_id = ${to} WHERE actor_id IN ${from};`,
    );
  }

  lines.push(
    `INSERT INTO identity_doctor_profiles (user_id, country, license_number, specialty, clinic_name)
     VALUES (${q(doctor)}::uuid, 'LY', 'DEV-LY-0001', 'Radiology', 'Sample Referring Clinic'),
            (${q(receiver)}::uuid, 'TN', 'DEV-TN-0002', 'Radiology', 'Sample Receiving Clinic')
     ON CONFLICT (user_id) DO NOTHING;`,
  );

  /*
   * Insert-if-absent by phone, NOT `ON CONFLICT (phone_e164)`.
   *
   * That column is deliberately not unique. Two people sharing a number — a
   * family, a clinic switchboard — is common enough that P3.3 forbids treating
   * a phone match as identity; the controller returns `confirmation_required`
   * and lets the doctor decide. A seed that declared it a key would assert the
   * opposite.
   */
  for (const p of PATIENTS) {
    lines.push(
      `INSERT INTO patients_patients
         (phone_e164, full_name, date_of_birth, sex, created_by_doctor, claimed_by_user)
       SELECT ${q(p.phone)}, ${q(p.name)}, ${q(p.dob)}::date, ${q(p.sex)},
              ${q(doctor)}::uuid, ${p.claim ? `${q(patientUser)}::uuid` : 'NULL'}
       WHERE NOT EXISTS (SELECT 1 FROM patients_patients WHERE phone_e164 = ${q(p.phone)});`,
    );
  }

  lines.push(
    `INSERT INTO scheduling_availability (doctor_id, starts_at, ends_at, slot_minutes)
     SELECT ${q(receiver)}::uuid, now() + interval '1 day', now() + interval '1 day 6 hours', 30
     WHERE NOT EXISTS (SELECT 1 FROM scheduling_availability WHERE doctor_id = ${q(receiver)}::uuid);`,
  );

  // A spread of statuses, so the tiles and the receiving doctor's inbox are not
  // all one number. Dated relative to now, so "upcoming" is never in the past.
  const appointments = [
    { phone: PATIENTS[0].phone, days: 2, status: 'confirmed' },
    { phone: PATIENTS[1].phone, days: 3, status: 'authorised' },
    { phone: PATIENTS[2].phone, days: 5, status: 'authorised' },
    { phone: PATIENTS[3].phone, days: 9, status: 'pending_payment' },
    { phone: PATIENTS[1].phone, days: -6, status: 'completed' },
  ];
  for (const a of appointments) {
    const patientRef = `(SELECT id FROM patients_patients WHERE phone_e164 = ${q(a.phone)} LIMIT 1)`;
    lines.push(
      `INSERT INTO scheduling_appointments (patient_id, doctor_id, starts_at, ends_at, status)
       SELECT ${patientRef}, ${q(receiver)}::uuid,
              now() + interval '${a.days} days',
              now() + interval '${a.days} days' + interval '30 minutes', ${q(a.status)}
       WHERE ${patientRef} IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM scheduling_appointments
           WHERE patient_id = ${patientRef} AND status = ${q(a.status)});`,
    );
  }

  /*
   * A HOSPITAL, so the provisioning and routing features have something to
   * stand on.
   *
   * The seeded clinic above is the referring side's. This is a receiving-side
   * HOSPITAL: it owns clinicians of different specialties, and the assistant is
   * seated in it so `app_assists_doctor` resolves for all of them. Without this
   * the clinician picker on the booking screen has exactly one name in it and
   * the specialty filter demonstrates nothing.
   */
  const hospitalName = 'Sample Receiving Hospital';
  lines.push(
    `INSERT INTO identity_organisations
       (kind, legal_name, corridor_id, side, verification_status, decided_at, seat_count, credentials)
     SELECT 'hospital', ${q(hospitalName)}, 'ly-tn', 'destination', 'approved', now(), 20,
            '{"cnomNumber":"DEV-TN-0002"}'::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM identity_organisations WHERE legal_name = ${q(hospitalName)});`,
  );

  const hospitalRef = `(SELECT id FROM identity_organisations WHERE legal_name = ${q(hospitalName)})`;
  const seat = (user, role, specialty) =>
    `INSERT INTO identity_memberships (organisation_id, user_id, seat_role, specialty)
     SELECT ${hospitalRef}, ${q(user)}::uuid, ${q(role)}, ${specialty === null ? 'NULL' : q(specialty)}
     ON CONFLICT (organisation_id, user_id) DO UPDATE SET specialty = EXCLUDED.specialty;`;

  lines.push(
    seat(receiver, 'owner', 'General medicine'),
    seat(radiologist, 'member', 'Radiology'),
    seat(cardiologist, 'member', 'Cardiology'),
    seat(assistant, 'assistant', null),
  );

  // Doctor profiles, so `listDoctors` (which filters on verified_at) offers the
  // specialists to a referring doctor as well.
  for (const [who, specialty] of [
    [radiologist, 'Radiology'],
    [cardiologist, 'Cardiology'],
  ]) {
    lines.push(
      `INSERT INTO identity_doctor_profiles
         (user_id, country, license_number, specialty, clinic_name, verified_at, verified_by)
       SELECT ${q(who)}::uuid, 'TN', 'DEV-TN-LIC-' || substr(${q(who)}, 1, 8), ${q(specialty)},
              ${q(hospitalName)}, now(), ${q(ops)}::uuid
       ON CONFLICT (user_id) DO UPDATE SET specialty = EXCLUDED.specialty;`,
    );
  }

  /*
   * TODAY'S AGENDA.
   *
   * The appointments above are all days away, so /schedule — whose whole job is
   * "who is coming today" — opened empty on a freshly seeded database and looked
   * broken. These are anchored to today's date at fixed local hours, with a
   * spread of statuses so the per-row actions have something to act on.
   */
  const todayAt = (hour, minutes) =>
    `date_trunc('day', now()) + interval '${hour} hours ${minutes} minutes'`;

  const todays = [
    { phone: PATIENTS[0].phone, doctor: receiver, hour: 9, status: 'confirmed', kind: 'follow_up', reason: 'Reviewing last scan' },
    { phone: PATIENTS[1].phone, doctor: radiologist, hour: 10, status: 'confirmed', kind: 'imaging', reason: 'Chest imaging' },
    { phone: PATIENTS[2].phone, doctor: cardiologist, hour: 11, status: 'confirmed', kind: 'consultation', reason: 'Palpitations' },
    { phone: PATIENTS[3].phone, doctor: receiver, hour: 8, status: 'completed', kind: 'consultation', reason: 'Routine review' },
    { phone: PATIENTS[0].phone, doctor: radiologist, hour: 7, status: 'no_show', kind: 'imaging', reason: 'Follow-up imaging' },
  ];
  for (const a of todays) {
    const patientRef = `(SELECT id FROM patients_patients WHERE phone_e164 = ${q(a.phone)} LIMIT 1)`;
    lines.push(
      `INSERT INTO scheduling_appointments
         (patient_id, doctor_id, starts_at, ends_at, status, kind, reason)
       SELECT ${patientRef}, ${q(a.doctor)}::uuid, ${todayAt(a.hour, 0)},
              ${todayAt(a.hour, 30)}, ${q(a.status)}, ${q(a.kind)}, ${q(a.reason)}
       WHERE ${patientRef} IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM scheduling_appointments
           WHERE doctor_id = ${q(a.doctor)}::uuid AND starts_at = ${todayAt(a.hour, 0)});`,
    );
  }

  /*
   * Opening hours for the specialists, and one RECURRING rule, so the
   * availability tab shows both shapes it supports.
   */
  for (const who of [radiologist, cardiologist]) {
    lines.push(
      `INSERT INTO scheduling_availability (doctor_id, starts_at, ends_at, slot_minutes)
       SELECT ${q(who)}::uuid, date_trunc('day', now()) + interval '1 day 8 hours',
              date_trunc('day', now()) + interval '1 day 13 hours', 30
       WHERE NOT EXISTS (SELECT 1 FROM scheduling_availability WHERE doctor_id = ${q(who)}::uuid);`,
    );
  }

  lines.push(
    `INSERT INTO scheduling_availability_rules
       (doctor_id, weekday, start_time, end_time, timezone, slot_minutes, valid_from)
     SELECT ${q(receiver)}::uuid, 2, '09:00', '12:00', 'Africa/Tunis', 30, CURRENT_DATE
     WHERE NOT EXISTS (
       SELECT 1 FROM scheduling_availability_rules WHERE doctor_id = ${q(receiver)}::uuid);`,
  );

  /*
   * Consent, WITHOUT WHICH THE RECEIVING DOCTOR'S INBOX IS EMPTY.
   *
   * `patients_receiving_doctor` requires BOTH an appointment and an unrevoked
   * `cross_border_transfer` consent granted to that doctor. The appointment
   * list joins the patient row, so with no consent the join yields nothing and
   * the inbox looks broken when it is in fact working exactly as designed —
   * the receiving side cannot see a patient it has no consent for.
   *
   * Seeded for the two patients with upcoming appointments, so the inbox has
   * something in it and the gate is still visible on the others.
   */
  for (const phone of [PATIENTS[0].phone, PATIENTS[1].phone]) {
    const patientRef = `(SELECT id FROM patients_patients WHERE phone_e164 = ${q(phone)} LIMIT 1)`;
    lines.push(
      `INSERT INTO consent_records
         (patient_id, scope, granted_to, terms_version, terms_locale, evidence_hash)
       SELECT ${patientRef}, 'cross_border_transfer', ${q(receiver)}::uuid, 'v1', 'ar',
              encode(sha256(('dev-seed:' || ${q(phone)})::bytea), 'hex')
       WHERE ${patientRef} IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM consent_records
           WHERE patient_id = ${patientRef}
             AND granted_to = ${q(receiver)}::uuid
             AND scope = 'cross_border_transfer');`,
    );
  }

  // An APPROVED organisation for the referring doctor, so /verification,
  // /settings/team and /settings/billing render something — and a PENDING one
  // for the applicant, so the ops queue is not empty.
  const approved = 'Sample Referring Clinic';
  const pending = 'Sample Pending Laboratory';
  lines.push(
    `INSERT INTO identity_organisations
       (kind, legal_name, corridor_id, side, verification_status, decided_at, seat_count, credentials)
     SELECT 'clinic', ${q(approved)}, 'ly-tn', 'source', 'approved', now(), 5,
            '{"licenceNumber":"DEV-LY-0001"}'::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM identity_organisations WHERE legal_name = ${q(approved)});`,
    `INSERT INTO identity_organisations
       (kind, legal_name, corridor_id, side, verification_status, seat_count, credentials)
     SELECT 'laboratory', ${q(pending)}, 'ly-tn', 'destination', 'pending', 2,
            '{"cnomNumber":"DEV-TN-9999"}'::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM identity_organisations WHERE legal_name = ${q(pending)});`,
    `INSERT INTO identity_memberships (organisation_id, user_id, seat_role)
     SELECT o.id, ${q(doctor)}::uuid, 'owner' FROM identity_organisations o
     WHERE o.legal_name = ${q(approved)} ON CONFLICT DO NOTHING;`,
    `INSERT INTO identity_memberships (organisation_id, user_id, seat_role)
     SELECT o.id, ${q(receiver)}::uuid, 'member' FROM identity_organisations o
     WHERE o.legal_name = ${q(approved)} ON CONFLICT DO NOTHING;`,
    `INSERT INTO identity_memberships (organisation_id, user_id, seat_role)
     SELECT o.id, ${q(applicant)}::uuid, 'owner' FROM identity_organisations o
     WHERE o.legal_name = ${q(pending)} ON CONFLICT DO NOTHING;`,
    // The assistant shares the approved clinic with BOTH doctors seated above,
    // which is what makes app_assists_doctor() true for either of them.
    `INSERT INTO identity_memberships (organisation_id, user_id, seat_role)
     SELECT o.id, ${q(assistant)}::uuid, 'assistant' FROM identity_organisations o
     WHERE o.legal_name = ${q(approved)} ON CONFLICT DO NOTHING;`,
    `INSERT INTO billing_subscriptions
       (organisation_id, plan_code, status, seats, period_start, period_end)
     SELECT o.id, 'clinic', 'active', 5, date_trunc('month', now()),
            date_trunc('month', now()) + interval '1 month'
     FROM identity_organisations o WHERE o.legal_name = ${q(approved)}
     ON CONFLICT (organisation_id) DO NOTHING;`,
  );

  /*
   * A few audit rows so the admin dashboard's allowed/denied tiles are not both
   * zero. There is NO `outcome` column: audit.service.ts derives it from
   * `metadata->>'granted'`, because a denial carries no subject_id — the row
   * was invisible, which is the point. Only an explicit false reads as denied.
   */
  lines.push(
    `INSERT INTO audit_events (actor_id, actor_role, action, subject_type, metadata, occurred_at)
     SELECT ${q(doctor)}::uuid, 'libya_doctor', a.action, 'patient',
            jsonb_build_object('granted', a.granted), now() - (a.n || ' hours')::interval
     FROM (VALUES ('patient.create', true, 1), ('study.view', true, 2),
                  ('study.view', false, 3), ('patient.search', true, 4))
          AS a(action, granted, n)
     WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE actor_id = ${q(doctor)}::uuid);`,
  );

  lines.push('COMMIT;');
  return lines.join('\n\n');
}

async function seed(subs) {
  const sql = buildSeedSql(subs);

  if (DB_URL !== null) {
    const { Client } = requireFromApi('pg');
    const db = new Client({ connectionString: DB_URL });
    await db.connect();
    try {
      await db.query(sql);
    } finally {
      await db.end();
    }
    console.log(`  target     ${DB_URL.replace(/:[^:@/]*@/, ':***@')}`);
    return;
  }

  /*
   * `spawn`, not `execFile`. execFile has no `input` option — that belongs to
   * the *Sync* variants — so the script is never written, psql sits reading a
   * stdin that never closes, and the whole run hangs with no output at all.
   *
   * ON_ERROR_STOP matters just as much: without it psql exits 0 having skipped
   * every failed statement, which is a seed that reports success and inserted
   * nothing.
   */
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      'docker',
      ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', DB_NAME,
       '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (err.trim() !== '') {
        console.log(err.trim().split('\n').map((l) => `  psql: ${l}`).join('\n'));
      }
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`psql exited ${code} — nothing was seeded`));
    });
    child.stdin.end(sql);
  });
  console.log(`  target     docker exec ${DB_CONTAINER} (database "${DB_NAME}")`);
}

async function main() {
  assertLocal('KC_SERVER', KC);
  if (DB_URL !== null) assertLocal('DATABASE_MIGRATOR_URL', DB_URL);

  console.log('Keycloak');
  await configureRealm();
  await ensureRoles();
  await configureWebClient();
  await ensureAdminClient();
  const subs = await ensureUsers();

  console.log('\nDatabase');
  await seed(subs);
  console.log('  seeded     users, patients, appointments, organisations, subscription, audit');

  console.log('\nSign in at http://localhost:3001/login with any of:\n');
  for (const a of ACCOUNTS) {
    console.log(`  ${a.username.padEnd(28)} ${a.password.padEnd(26)} ${a.role}`);
  }
  console.log('\n⚠ This realm now has TLS enforcement off and a hardcoded amr=otp mapper.');
  console.log('  Development only. See the note at the top of this script.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
