import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asUser,
  createCase,
  createPatient,
  createPractice,
  createUser,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';

/**
 * Who may touch a consult report — migration 0034, spec 2026-09-21 §5.
 *
 * Run through the APPLICATION pool with a session context, so every assertion
 * is the policy's answer rather than the service's. State that a test needs
 * beforehand is written through the owner connection.
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

async function world(status: 'accepted' | 'paid' = 'accepted') {
  const { doctorId: lab } = await createPractice(h.owner, 'libya_doctor');
  const patient = await createPatient(h.owner, lab);
  const doctor = await createUser(h.owner, 'tunisia_doctor');
  const caseId = await createCase(h.owner, patient, doctor, status);
  return { lab, doctor, caseId };
}

const insertDraftSql = `INSERT INTO cases_reports (case_id, author_id, content)
                        VALUES ($1, $2, '{}'::jsonb) RETURNING case_id`;

async function seedReport(caseId: string, author: string, status: 'draft' | 'submitted') {
  await h.owner.query(
    `INSERT INTO cases_reports (case_id, author_id, content, status, submitted_at)
     VALUES ($1, $2, '{"impression":["x"]}'::jsonb, $3, CASE WHEN $3 = 'submitted' THEN now() END)`,
    [caseId, author, status],
  );
}

const readAs = (userId: string, role: string, caseId: string) =>
  asUser(h.app, { userId, role }, async (c) =>
    (await c.query('SELECT case_id FROM cases_reports WHERE case_id = $1', [caseId])).rows,
  );

describe('cases_reports row-level security', () => {
  it('the assigned doctor drafts on an accepted case and reads it back', async () => {
    const { doctor, caseId } = await world('accepted');
    const rows = await asUser(h.app, { userId: doctor, role: 'tunisia_doctor' }, async (c) => {
      await c.query(insertDraftSql, [caseId, doctor]);
      return (await c.query('SELECT case_id FROM cases_reports WHERE case_id = $1', [caseId])).rows;
    });
    expect(rows).toHaveLength(1);
  });

  it('the doctor cannot draft before accepting the case', async () => {
    const { doctor, caseId } = await world('paid');
    await expect(
      asUser(h.app, { userId: doctor, role: 'tunisia_doctor' }, (c) =>
        c.query(insertDraftSql, [caseId, doctor]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('another doctor sees nothing', async () => {
    const { doctor, caseId } = await world();
    await seedReport(caseId, doctor, 'submitted');
    const other = await createUser(h.owner, 'tunisia_doctor');
    expect(await readAs(other, 'tunisia_doctor', caseId)).toHaveLength(0);
  });

  it('the referring clinic reads the report only once it is submitted', async () => {
    const { lab, doctor, caseId } = await world();
    await seedReport(caseId, doctor, 'draft');
    expect(await readAs(lab, 'libya_doctor', caseId)).toHaveLength(0);

    await h.owner.query(
      `UPDATE cases_reports SET status = 'submitted', submitted_at = now() WHERE case_id = $1`,
      [caseId],
    );
    expect(await readAs(lab, 'libya_doctor', caseId)).toHaveLength(1);
  });

  it('a submitted report is read-only for its author', async () => {
    const { doctor, caseId } = await world();
    await seedReport(caseId, doctor, 'submitted');
    const changed = await asUser(h.app, { userId: doctor, role: 'tunisia_doctor' }, async (c) =>
      (await c.query(`UPDATE cases_reports SET content = '{"x":1}'::jsonb WHERE case_id = $1`, [caseId]))
        .rowCount,
    );
    expect(changed).toBe(0);
  });

  it('ops reads it', async () => {
    const { doctor, caseId } = await world();
    await seedReport(caseId, doctor, 'draft');
    const admin = await createUser(h.owner, 'admin');
    expect(await readAs(admin, 'admin', caseId)).toHaveLength(1);
  });
});
