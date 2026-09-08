import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asUser,
  createCase,
  createPatient,
  createStudy,
  createUser,
  grantConsent,
  linkStudy,
  revokeConsent,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from './testing/rls-harness';

/**
 * BUILD_SPEC P3.2 — the seven required row-level-security tests, plus the
 * cases the seven imply.
 *
 * "Broken access control is the most common cause of serious breaches in
 * early-stage health platforms." These run in CI on every commit.
 *
 * Every assertion runs on the `mir_app` connection: a non-superuser,
 * non-owner, NOBYPASSRLS role with exactly the privileges the deployed
 * application has. Asserting on the owner connection would prove nothing,
 * because the owner bypasses the policies being tested.
 */

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

describe('P3.2 row-level security', () => {
  // -------------------------------------------------------------------------
  // Preconditions. If these fail, every test below is meaningless.
  // -------------------------------------------------------------------------
  describe('preconditions', () => {
    it('the application role is not a superuser and cannot bypass RLS', async () => {
      const res = await h.app.query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        current_user: string;
      }>(
        `SELECT r.rolsuper, r.rolbypassrls, current_user
         FROM pg_roles r WHERE r.rolname = current_user`,
      );
      const row = res.rows[0];
      expect(row?.current_user).toBe('mir_app');
      expect(row?.rolsuper).toBe(false);
      // ADR-6: if this is ever true, every policy in the system is decorative.
      expect(row?.rolbypassrls).toBe(false);
    });

    it('the application role does not own the patient-data tables', async () => {
      // Owners bypass RLS unless FORCE is set, and can drop policies outright.
      const res = await h.app.query<{ tablename: string; tableowner: string }>(
        `SELECT tablename, tableowner FROM pg_tables
         WHERE schemaname = 'public' AND tablename IN
           ('imaging_studies','patients_patients','consent_records','audit_events')`,
      );
      expect(res.rows.length).toBe(4);
      for (const row of res.rows) {
        expect(row.tableowner).not.toBe('mir_app');
      }
    });

    it('RLS is enabled AND forced on every patient-data table', async () => {
      const res = await h.app.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class
         WHERE relname IN ('imaging_studies','imaging_instances','patients_patients',
                           'consent_records','cases_cases','audit_events')`,
      );
      expect(res.rows.length).toBe(6);
      for (const row of res.rows) {
        expect(row.relrowsecurity, `${row.relname} RLS enabled`).toBe(true);
        expect(row.relforcerowsecurity, `${row.relname} RLS forced`).toBe(true);
      }
    });

    it('an unset session context returns nothing rather than throwing', async () => {
      // The spec's example policy uses current_setting('app.user_role') with no
      // second argument, which THROWS when unset. That would break migrations,
      // health checks and background jobs. Ours returns NULL, and NULL denies.
      const doctor = await createUser(h.owner, 'libya_doctor');
      const patient = await createPatient(h.owner, doctor);
      await createStudy(h.owner, patient, doctor);

      const res = await h.app.query('SELECT * FROM imaging_studies');
      expect(res.rowCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // The seven required tests
  // -------------------------------------------------------------------------

  it('1. Libyan doctor A cannot see studies uploaded by doctor B', async () => {
    const doctorA = await createUser(h.owner, 'libya_doctor');
    const doctorB = await createUser(h.owner, 'libya_doctor');
    const patientOfB = await createPatient(h.owner, doctorB);
    await createStudy(h.owner, patientOfB, doctorB);

    const rows = await asUser(h.app, { userId: doctorA, role: 'libya_doctor' }, async (c) => {
      const r = await c.query('SELECT id FROM imaging_studies');
      return r.rowCount;
    });
    expect(rows).toBe(0);

    // And confirm doctor B *can* see it — otherwise this test would pass
    // against a policy that simply denies everyone.
    const bRows = await asUser(h.app, { userId: doctorB, role: 'libya_doctor' }, async (c) => {
      const r = await c.query('SELECT id FROM imaging_studies');
      return r.rowCount;
    });
    expect(bRows).toBe(1);
  });

  /**
   * P3.2's second required test, restated for a system with no patient logins.
   *
   * It used to read "Patient X cannot see patient Y studies". Migration 0021
   * removed patient accounts, so that isolation is now structural rather than
   * policy-enforced: there is no patient session in which the leak could
   * happen. Asserting it against a role that cannot exist would be a test that
   * can never fail, which is worse than no test.
   *
   * The cross-patient leak that remains POSSIBLE is on the receiving side — a
   * Tunisian doctor holding a session, reaching a patient who is not theirs.
   * That is what this now proves.
   */
  it('2. a receiving doctor cannot see the studies of a patient who is not theirs', async () => {
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');

    const mine = await createPatient(h.owner, libyaDoctor);
    const theirs = await createPatient(h.owner, libyaDoctor);
    const myStudy = await createStudy(h.owner, mine, libyaDoctor);
    await createStudy(h.owner, theirs, libyaDoctor);

    // A complete, valid path to exactly one of the two patients.
    const appt = await createCase(h.owner, mine, tunisDoctor, 'accepted');
    await linkStudy(h.owner, appt, myStudy);
    await grantConsent(h.owner, mine, tunisDoctor, libyaDoctor);

    const seen = await asUser(h.app, { userId: tunisDoctor, role: 'tunisia_doctor' }, async (c) => {
      const r = await c.query<{ patient_id: string }>('SELECT patient_id FROM imaging_studies');
      return r.rows.map((row) => row.patient_id);
    });

    // Exactly the one they have a path to — and the assertion is on identity,
    // not on a count, so a policy that returned the wrong single row fails.
    expect(seen).toEqual([mine]);
    expect(seen).not.toContain(theirs);
  });

  it('3. Tunisian doctor with an appointment but NO consent sees nothing', async () => {
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, libyaDoctor);
    const study = await createStudy(h.owner, patient, libyaDoctor);
    const appt = await createCase(h.owner, patient, tunisDoctor, 'accepted');
    await linkStudy(h.owner, appt, study);
    // Deliberately no consent record.

    const rows = await asUser(h.app, { userId: tunisDoctor, role: 'tunisia_doctor' }, async (c) => {
      const r = await c.query('SELECT id FROM imaging_studies');
      return r.rowCount;
    });
    expect(rows).toBe(0);
  });

  it('4. Tunisian doctor with an appointment AND valid consent sees exactly one study', async () => {
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, libyaDoctor);
    const study = await createStudy(h.owner, patient, libyaDoctor);
    const appt = await createCase(h.owner, patient, tunisDoctor, 'accepted');
    await linkStudy(h.owner, appt, study);
    await grantConsent(h.owner, patient, tunisDoctor, libyaDoctor);

    const rows = await asUser(h.app, { userId: tunisDoctor, role: 'tunisia_doctor' }, async (c) => {
      const r = await c.query<{ id: string }>('SELECT id FROM imaging_studies');
      return r.rows.map((row) => row.id);
    });
    expect(rows).toEqual([study]);
  });

  it('5. revoking consent removes access immediately', async () => {
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, libyaDoctor);
    const study = await createStudy(h.owner, patient, libyaDoctor);
    const appt = await createCase(h.owner, patient, tunisDoctor, 'accepted');
    await linkStudy(h.owner, appt, study);
    const consent = await grantConsent(h.owner, patient, tunisDoctor, libyaDoctor);

    const before = await asUser(h.app, { userId: tunisDoctor, role: 'tunisia_doctor' }, async (c) =>
      (await c.query('SELECT id FROM imaging_studies')).rowCount,
    );
    expect(before).toBe(1);

    await revokeConsent(h.owner, consent);

    const after = await asUser(h.app, { userId: tunisDoctor, role: 'tunisia_doctor' }, async (c) =>
      (await c.query('SELECT id FROM imaging_studies')).rowCount,
    );
    expect(after).toBe(0);
  });

  it('6. the application role cannot escalate with SET ROLE postgres', async () => {
    await expect(
      asUser(h.app, { userId: await createUser(h.owner, 'admin'), role: 'admin' }, async (c) => {
        await c.query('SET ROLE postgres');
      }),
    ).rejects.toThrow(/permission denied|must be (a )?member of role/i);
  });

  it('7. nobody can DELETE or UPDATE audit_events', async () => {
    const admin = await createUser(h.owner, 'admin');
    await h.owner.query(
      `INSERT INTO audit_events (actor_id, actor_role, action, subject_type)
       VALUES ($1, 'admin', 'StudyAccessed', 'study')`,
      [admin],
    );

    // DELETE — permission denied at the GRANT level, before any policy runs.
    await expect(
      asUser(h.app, { userId: admin, role: 'admin' }, async (c) => {
        await c.query('DELETE FROM audit_events');
      }),
    ).rejects.toThrow(/permission denied/i);

    // UPDATE — same. P4.4 requires the log to be append-only, and "append-only"
    // has to mean tamper-proof, not merely "we don't have an update endpoint".
    await expect(
      asUser(h.app, { userId: admin, role: 'admin' }, async (c) => {
        await c.query("UPDATE audit_events SET action = 'tampered'");
      }),
    ).rejects.toThrow(/permission denied/i);

    // The row survived both attempts.
    const res = await h.owner.query<{ action: string }>('SELECT action FROM audit_events');
    expect(res.rows[0]?.action).toBe('StudyAccessed');
  });

  // -------------------------------------------------------------------------
  // Imaging unlocks on ACCEPTANCE (migration 0025), not on payment.
  //
  // This replaces the D3 triage toggle. A summary before acceptance is now the
  // flow rather than a configuration of it, so there is no longer a setting
  // that can make these pass or fail — only the case's status.
  // -------------------------------------------------------------------------
  describe('imaging unlocks on acceptance', () => {
    async function scenario(status: 'paid' | 'accepted' | 'answered' | 'declined',
                            opts: { consent?: boolean } = {}) {
      const libyaDoctor = await createUser(h.owner, 'libya_doctor');
      const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
      const patient = await createPatient(h.owner, libyaDoctor);
      const study = await createStudy(h.owner, patient, libyaDoctor);
      const caseId = await createCase(h.owner, patient, tunisDoctor, status);
      await linkStudy(h.owner, caseId, study);
      if (opts.consent !== false) {
        await grantConsent(h.owner, patient, tunisDoctor, libyaDoctor);
      }
      return { tunisDoctor, caseId };
    }

    const studiesVisibleTo = async (userId: string): Promise<number | null> =>
      asUser(h.app, { userId, role: 'tunisia_doctor' }, async (c) =>
        (await c.query('SELECT id FROM imaging_studies')).rowCount,
      );

    it('a paid case shows the doctor no imaging — they triage on the summary', async () => {
      const { tunisDoctor } = await scenario('paid');
      expect(await studiesVisibleTo(tunisDoctor)).toBe(0);
    });

    it('an accepted case shows the doctor the imaging', async () => {
      const { tunisDoctor } = await scenario('accepted');
      expect(await studiesVisibleTo(tunisDoctor)).toBe(1);
    });

    it('a declined case gives the imaging back up', async () => {
      // The predicate used to read `status <> 'cancelled'`, which was a
      // complete way to say "still standing" only while 'declined' did not
      // exist. Refusing a case must surrender its imaging.
      const { tunisDoctor, caseId } = await scenario('accepted');
      expect(await studiesVisibleTo(tunisDoctor)).toBe(1);

      await h.owner.query(`UPDATE cases_cases SET status = 'declined' WHERE id = $1`, [caseId]);

      expect(await studiesVisibleTo(tunisDoctor)).toBe(0);
    });

    it('an answered case keeps the imaging readable to its author', async () => {
      // A doctor must be able to re-read what they diagnosed from, or the
      // record they signed is one they can no longer inspect.
      const { tunisDoctor } = await scenario('answered');
      expect(await studiesVisibleTo(tunisDoctor)).toBe(1);
    });

    it('acceptance never bypasses consent', async () => {
      const { tunisDoctor } = await scenario('accepted', { consent: false });
      expect(await studiesVisibleTo(tunisDoctor)).toBe(0);
    });

    it('an expired case surrenders the imaging with the fee', async () => {
      const { tunisDoctor, caseId } = await scenario('accepted');
      await h.owner.query(`UPDATE cases_cases SET status = 'expired' WHERE id = $1`, [caseId]);
      expect(await studiesVisibleTo(tunisDoctor)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Cases the seven imply but do not state
  // -------------------------------------------------------------------------
  describe('additional isolation', () => {
    it('consent naming doctor A does not grant access to doctor B', async () => {
      const libyaDoctor = await createUser(h.owner, 'libya_doctor');
      const doctorA = await createUser(h.owner, 'tunisia_doctor');
      const doctorB = await createUser(h.owner, 'tunisia_doctor');
      const patient = await createPatient(h.owner, libyaDoctor);
      const study = await createStudy(h.owner, patient, libyaDoctor);

      // Both doctors have an appointment; consent names only A.
      const apptA = await createCase(h.owner, patient, doctorA, 'accepted');
      // No second timestamp: with no slots, two cases for the same patient do
      // not collide, so there is nothing left to space them apart.
      const apptB = await createCase(h.owner, patient, doctorB, 'accepted');
      await linkStudy(h.owner, apptA, study);
      await linkStudy(h.owner, apptB, study);
      await grantConsent(h.owner, patient, doctorA, libyaDoctor);

      const seenByA = await asUser(h.app, { userId: doctorA, role: 'tunisia_doctor' }, async (c) =>
        (await c.query('SELECT id FROM imaging_studies')).rowCount,
      );
      const seenByB = await asUser(h.app, { userId: doctorB, role: 'tunisia_doctor' }, async (c) =>
        (await c.query('SELECT id FROM imaging_studies')).rowCount,
      );

      expect(seenByA).toBe(1);
      expect(seenByB).toBe(0);
    });

    it('a cancelled appointment revokes access even with valid consent', async () => {
      const libyaDoctor = await createUser(h.owner, 'libya_doctor');
      const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
      const patient = await createPatient(h.owner, libyaDoctor);
      const study = await createStudy(h.owner, patient, libyaDoctor);
      const appt = await createCase(h.owner, patient, tunisDoctor, 'cancelled');
      await linkStudy(h.owner, appt, study);
      await grantConsent(h.owner, patient, tunisDoctor, libyaDoctor);

      const rows = await asUser(h.app, { userId: tunisDoctor, role: 'tunisia_doctor' }, async (c) =>
        (await c.query('SELECT id FROM imaging_studies')).rowCount,
      );
      expect(rows).toBe(0);
    });

    /**
     * Was "an unclaimed patient record is invisible to every patient account".
     * There are no patient accounts (migration 0021), so the containment that
     * mattered is now between DOCTORS: a referring doctor reaches exactly the
     * patients they created, which is the surviving half of DECISION D1.
     */
    it('a patient record is invisible to a doctor who did not create it', async () => {
      const author = await createUser(h.owner, 'libya_doctor');
      const stranger = await createUser(h.owner, 'libya_doctor');
      await createPatient(h.owner, author);

      const rows = await asUser(h.app, { userId: stranger, role: 'libya_doctor' }, async (c) =>
        (await c.query('SELECT id FROM patients_patients')).rowCount,
      );
      expect(rows).toBe(0);

      // The control: the doctor who created it does see it. Without this the
      // test would pass against a policy that denies everyone.
      const own = await asUser(h.app, { userId: author, role: 'libya_doctor' }, async (c) =>
        (await c.query('SELECT id FROM patients_patients')).rowCount,
      );
      expect(own).toBe(1);
    });

    it('imaging_instances visibility follows the parent study', async () => {
      const doctorA = await createUser(h.owner, 'libya_doctor');
      const doctorB = await createUser(h.owner, 'libya_doctor');
      const patient = await createPatient(h.owner, doctorB);
      const study = await createStudy(h.owner, patient, doctorB);
      await h.owner.query(
        `INSERT INTO imaging_instances (study_id, sop_uid, series_uid, storage_key, size_bytes, sha256)
         VALUES ($1, '1.2.3.4', '1.2.3', 'k', 100, $2)`,
        [study, 'b'.repeat(64)],
      );

      const seenByA = await asUser(h.app, { userId: doctorA, role: 'libya_doctor' }, async (c) =>
        (await c.query('SELECT id FROM imaging_instances')).rowCount,
      );
      const seenByB = await asUser(h.app, { userId: doctorB, role: 'libya_doctor' }, async (c) =>
        (await c.query('SELECT id FROM imaging_instances')).rowCount,
      );

      expect(seenByA).toBe(0);
      expect(seenByB).toBe(1);
    });

    it('a doctor cannot insert a study against another doctor patient', async () => {
      const doctorA = await createUser(h.owner, 'libya_doctor');
      const doctorB = await createUser(h.owner, 'libya_doctor');
      const patientOfB = await createPatient(h.owner, doctorB);

      await expect(
        asUser(h.app, { userId: doctorA, role: 'libya_doctor' }, async (c) => {
          await c.query(
            `INSERT INTO imaging_studies (patient_id, uploaded_by, study_instance_uid, modality)
             VALUES ($1, $2, '1.2.3.999', 'CT')`,
            [patientOfB, doctorA],
          );
        }),
      ).rejects.toThrow(/row-level security/i);
    });

    it('admins cannot read patient imaging (no routine access, §1.1)', async () => {
      const doctor = await createUser(h.owner, 'libya_doctor');
      const admin = await createUser(h.owner, 'admin');
      const patient = await createPatient(h.owner, doctor);
      await createStudy(h.owner, patient, doctor);

      const rows = await asUser(h.app, { userId: admin, role: 'admin' }, async (c) =>
        (await c.query('SELECT id FROM imaging_studies')).rowCount,
      );
      expect(rows).toBe(0);
    });

  });

  describe('the receiving doctor never reads the patient', () => {
    it('a receiving doctor has no read on the patient table at all', async () => {
      const libyaDoctor = await createUser(h.owner, 'libya_doctor');
      const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
      const patient = await createPatient(h.owner, libyaDoctor);
      const kase = await createCase(h.owner, patient, tunisDoctor, 'accepted');
      await grantConsent(h.owner, patient, tunisDoctor, libyaDoctor);

      // Everything that used to grant the row is present: an accepted case and
      // a valid consent. The grant is gone anyway.
      const rows = await asUser(h.app, { userId: tunisDoctor, role: 'tunisia_doctor' }, async (c) =>
        (await c.query('SELECT id FROM patients_patients')).rowCount,
      );
      expect(rows).toBe(0);

      // The control: the lab that created the patient still sees them.
      const lab = await asUser(h.app, { userId: libyaDoctor, role: 'libya_doctor' }, async (c) =>
        (await c.query('SELECT id FROM patients_patients')).rowCount,
      );
      expect(lab).toBe(1);
      expect(kase).toBeDefined();
    });

    it('the case query returns a null patient name to the doctor and a name to the lab', async () => {
      const libyaDoctor = await createUser(h.owner, 'libya_doctor');
      const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
      const patient = await createPatient(h.owner, libyaDoctor);
      const kase = await createCase(h.owner, patient, tunisDoctor, 'accepted');
      await grantConsent(h.owner, patient, tunisDoctor, libyaDoctor);

      // The UNMODIFIED production join. The whole claim of this task is that
      // the database produces a null here without any application help.
      const sql = `SELECT p.full_name AS patient_name
                   FROM cases_cases a
                   LEFT JOIN patients_patients p ON p.id = a.patient_id
                   WHERE a.id = $1`;

      const asDoctor = await asUser(
        h.app,
        { userId: tunisDoctor, role: 'tunisia_doctor' },
        async (c) => (await c.query<{ patient_name: string | null }>(sql, [kase])).rows[0],
      );
      expect(asDoctor?.patient_name).toBeNull();

      const asLab = await asUser(
        h.app,
        { userId: libyaDoctor, role: 'libya_doctor' },
        async (c) => (await c.query<{ patient_name: string | null }>(sql, [kase])).rows[0],
      );
      expect(asLab?.patient_name).not.toBeNull();
    });

    it('cases_patient_brief gives the doctor age and sex, and nobody else anything', async () => {
      const libyaDoctor = await createUser(h.owner, 'libya_doctor');
      const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
      const stranger = await createUser(h.owner, 'tunisia_doctor');
      const patient = await createPatient(h.owner, libyaDoctor, {
        dateOfBirth: '1990-01-01',
        sex: 'F',
      });
      const kase = await createCase(h.owner, patient, tunisDoctor, 'accepted');
      await grantConsent(h.owner, patient, tunisDoctor, libyaDoctor);

      const mine = await asUser(h.app, { userId: tunisDoctor, role: 'tunisia_doctor' }, async (c) =>
        (
          await c.query<{ age_years: number; sex: string }>(
            'SELECT age_years, sex FROM cases_patient_brief($1)',
            [kase],
          )
        ).rows,
      );
      expect(mine).toHaveLength(1);
      expect(mine[0]?.sex).toBe('F');
      expect(mine[0]?.age_years).toBeGreaterThan(30);

      const theirs = await asUser(h.app, { userId: stranger, role: 'tunisia_doctor' }, async (c) =>
        (await c.query('SELECT age_years FROM cases_patient_brief($1)', [kase])).rowCount,
      );
      expect(theirs).toBe(0);
    });

    it('cases_patient_brief returns nothing without consent, and nothing once revoked', async () => {
      const libyaDoctor = await createUser(h.owner, 'libya_doctor');
      const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
      const patient = await createPatient(h.owner, libyaDoctor);
      const kase = await createCase(h.owner, patient, tunisDoctor, 'accepted');

      const before = await asUser(
        h.app,
        { userId: tunisDoctor, role: 'tunisia_doctor' },
        async (c) =>
          (await c.query('SELECT age_years FROM cases_patient_brief($1)', [kase])).rowCount,
      );
      expect(before).toBe(0);

      const consent = await grantConsent(h.owner, patient, tunisDoctor, libyaDoctor);
      const during = await asUser(
        h.app,
        { userId: tunisDoctor, role: 'tunisia_doctor' },
        async (c) =>
          (await c.query('SELECT age_years FROM cases_patient_brief($1)', [kase])).rowCount,
      );
      expect(during).toBe(1);

      await revokeConsent(h.owner, consent);
      const after = await asUser(
        h.app,
        { userId: tunisDoctor, role: 'tunisia_doctor' },
        async (c) =>
          (await c.query('SELECT age_years FROM cases_patient_brief($1)', [kase])).rowCount,
      );
      expect(after).toBe(0);
    });

    it('age is capped at 90 for a patient older than that', async () => {
      const libyaDoctor = await createUser(h.owner, 'libya_doctor');
      const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
      const patient = await createPatient(h.owner, libyaDoctor, { dateOfBirth: '1920-03-02' });
      const kase = await createCase(h.owner, patient, tunisDoctor, 'accepted');
      await grantConsent(h.owner, patient, tunisDoctor, libyaDoctor);

      const rows = await asUser(h.app, { userId: tunisDoctor, role: 'tunisia_doctor' }, async (c) =>
        (
          await c.query<{ age_years: number }>('SELECT age_years FROM cases_patient_brief($1)', [
            kase,
          ])
        ).rows,
      );
      // Not 105. Safe Harbor treats ages over 89 as identifying.
      expect(rows[0]?.age_years).toBe(90);
    });
  });
});
