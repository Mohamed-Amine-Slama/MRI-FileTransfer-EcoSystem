import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { runWithContext, type RequestContext } from '../../shared/context/request-context';
import { DatabaseService } from '../../shared/db/database.service';
import {
  appUrl,
  createCase,
  createPatient,
  createPractice,
  createStudy,
  createUser,
  grantConsent,
  seedAcceptingDoctors,
  seedDoctor,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { EventBus } from '../../shared/events/event-bus';
import { CasesService } from './internal/cases.service';
import { LedgerService } from '../ledger';
import { PricingService } from '../pricing';

/**
 * The case lifecycle — consult-model spec Part 3.
 *
 * WHAT LEFT THIS FILE. It used to open with the P10.2 booking-concurrency gate
 * ("fire 50 concurrent bookings at one slot; exactly one wins") and the P10.1
 * timezone cases. Migration 0025 removed the slot and the exclusion constraint
 * that made that gate meaningful: with no contended resource there is nothing
 * for 50 callers to race for. Those tests were deleted rather than adapted,
 * because a concurrency test that can no longer fail is worse than none — it
 * reads as protection that is not there.
 *
 * What replaces them is below: the states a case moves through, and who may
 * move it.
 */

let h: Harness;
let db: DatabaseService;
let bus: EventBus;
let cases: CasesService;

const config = {
  CASES_ANSWER_WINDOW_HOURS: 72,
  CASES_QUOTE_TTL_MINUTES: 30,
} as AppConfig;

const ctx = (userId: string, role: RequestContext['role']): RequestContext => ({
  userId,
  role,
  ipAddress: '41.208.1.5',
  userAgent: 'vitest',
  requestId: 'cases-test',
});

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 20 } as AppConfig);
  bus = new EventBus();
  cases = new CasesService(db, bus, config, new LedgerService(db), new PricingService(db));
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

/** A referring lab, seated in a source organisation, with one patient. */
async function lab(): Promise<{ doctor: string; patient: string }> {
  const { doctorId } = await createPractice(h.owner, 'libya_doctor');
  const patient = await createPatient(h.owner, doctorId);
  return { doctor: doctorId, patient };
}

async function statusOf(caseId: string): Promise<string | undefined> {
  const row = await h.owner.query<{ status: string }>(
    'SELECT status FROM cases_cases WHERE id = $1',
    [caseId],
  );
  return row.rows[0]?.status;
}

describe('submitting a case', () => {
  it('starts at submitted, with no doctor and no price', async () => {
    // Both arrive together at quote, because the doctor's tier is a term in
    // the price. A case with one and not the other is unrepresentable.
    const { doctor, patient } = await lab();
    const item = await runWithContext(ctx(doctor, 'libya_doctor'), () =>
      cases.submit({ patientId: patient, specialty: 'radiology' }),
    );

    expect(item.status).toBe('submitted');
    expect(item.doctorId).toBeNull();
    expect(item.quotedAmountMinor).toBeNull();
    expect(item.specialty).toBe('radiology');
  });

  it('records the organisation that owes, from the caller, not the request', async () => {
    const { doctor, patient } = await lab();
    const item = await runWithContext(ctx(doctor, 'libya_doctor'), () =>
      cases.submit({ patientId: patient, specialty: 'radiology' }),
    );
    expect(item.organisationId).toBeTruthy();
  });

  it('emits CaseSubmitted exactly once', async () => {
    const { doctor, patient } = await lab();
    const seen: string[] = [];
    bus.subscribe('CaseSubmitted', (e) => {
      seen.push(e.caseId);
    });

    const item = await runWithContext(ctx(doctor, 'libya_doctor'), () =>
      cases.submit({ patientId: patient, specialty: 'radiology' }),
    );
    expect(seen).toEqual([item.id]);
  });

  it('cannot submit for a patient the caller did not create', async () => {
    // RLS refuses the row and the service turns that into 404, never 403: §6
    // requires "does not exist" and "not yours" to be indistinguishable.
    const { doctor } = await lab();
    const stranger = await createUser(h.owner, 'libya_doctor');
    const theirPatient = await createPatient(h.owner, stranger);

    await expect(
      runWithContext(ctx(doctor, 'libya_doctor'), () =>
        cases.submit({ patientId: theirPatient, specialty: 'radiology' }),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('a receiving doctor cannot submit a case at all', async () => {
    // A doctor creating a case would be a doctor referring to himself, and the
    // organisation lookup is source-side only, so there is nothing to charge.
    const { patient } = await lab();
    const tunis = await createUser(h.owner, 'tunisia_doctor');
    await expect(
      runWithContext(ctx(tunis, 'tunisia_doctor'), () =>
        cases.submit({ patientId: patient, specialty: 'radiology' }),
      ),
    ).rejects.toThrow();
  });
});

describe('study linkage', () => {
  it('links the studies the caller can see', async () => {
    const { doctor, patient } = await lab();
    const study = await createStudy(h.owner, patient, doctor);

    const item = await runWithContext(ctx(doctor, 'libya_doctor'), () =>
      cases.submit({ patientId: patient, specialty: 'radiology', studyIds: [study] }),
    );

    const { rows } = await h.owner.query<{ study_id: string }>(
      'SELECT study_id FROM cases_case_studies WHERE case_id = $1',
      [item.id],
    );
    expect(rows.map((r) => r.study_id)).toEqual([study]);
  });

  it('refuses the whole submission if a requested study is not linkable', async () => {
    // Partially linking would produce a case whose imaging is silently
    // incomplete, which is the failure BUILD_SPEC §17 calls out: a doctor
    // reading an incomplete study and missing a finding.
    const { doctor, patient } = await lab();
    const stranger = await createUser(h.owner, 'libya_doctor');
    const theirPatient = await createPatient(h.owner, stranger);
    const theirStudy = await createStudy(h.owner, theirPatient, stranger);

    await expect(
      runWithContext(ctx(doctor, 'libya_doctor'), () =>
        cases.submit({ patientId: patient, specialty: 'radiology', studyIds: [theirStudy] }),
      ),
    ).rejects.toThrow();

    const { rows } = await h.owner.query('SELECT id FROM cases_cases');
    expect(rows).toHaveLength(0);
  });
});

describe('quoting and paying', () => {
  /**
   * A lab, a patient, and a radiology market with five doctors in it — the
   * densest surge rung, so the price moves only when a test moves it.
   */
  async function market(): Promise<{ lab: string; patient: string; senior: string }> {
    const { doctorId } = await createPractice(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctorId);
    await seedAcceptingDoctors(h.owner, { specialty: 'radiology', count: 4 });
    const senior = await seedDoctor(h.owner, {
      specialty: 'radiology',
      tier: 'senior',
      accepting: true,
    });
    return { lab: doctorId, patient, senior };
  }

  const submitted = async (lab: string, patient: string): Promise<string> => {
    const item = await runWithContext(ctx(lab, 'libya_doctor'), () =>
      cases.submit({ patientId: patient, specialty: 'radiology' }),
    );
    return item.id;
  };

  it('quoting picks the doctor and locks the price in one act', async () => {
    const { lab, patient, senior } = await market();
    const caseId = await submitted(lab, patient);

    const quoted = await runWithContext(ctx(lab, 'libya_doctor'), () =>
      cases.quote(caseId, senior),
    );

    expect(quoted.status).toBe('quoted');
    expect(quoted.doctorId).toBe(senior);
    expect(quoted.quotedAmountMinor).toBe(4800); // 4000 x 1.20 x 1.00
    expect(quoted.quotedCurrency).toBe('USD');
    expect(quoted.quoteExpiresAt).not.toBeNull();
  });

  /**
   * THE POINT OF THE WHOLE QUOTE COLUMN. A price that moves between the screen
   * and the charge is a dispute the platform loses, so paying reads the stored
   * number and never recomputes one.
   */
  it('locks the quote: paying charges the stored number, not a fresh one', async () => {
    const { lab, patient, senior } = await market();
    const caseId = await submitted(lab, patient);
    await runWithContext(ctx(lab, 'libya_doctor'), () => cases.quote(caseId, senior));

    // The doctor is promoted between the quote and the payment.
    await h.owner.query(
      "UPDATE identity_doctor_profiles SET tier_code = 'expert' WHERE user_id = $1",
      [senior],
    );

    await runWithContext(ctx(lab, 'libya_doctor'), () => cases.markPaid(caseId));
    const after = await runWithContext(ctx(lab, 'libya_doctor'), () => cases.getCase(caseId));

    expect(after.status).toBe('paid');
    expect(after.quotedAmountMinor).toBe(4800);
  });

  it('refuses to pay against a lapsed quote', async () => {
    const { lab, patient, senior } = await market();
    const caseId = await submitted(lab, patient);
    await runWithContext(ctx(lab, 'libya_doctor'), () => cases.quote(caseId, senior));
    await h.owner.query(
      "UPDATE cases_cases SET quote_expires_at = now() - interval '1 minute' WHERE id = $1",
      [caseId],
    );

    await expect(
      runWithContext(ctx(lab, 'libya_doctor'), () => cases.markPaid(caseId)),
    ).rejects.toThrow(/lapsed/i);
    expect(await statusOf(caseId)).toBe('quoted');
  });

  it('cannot quote against a doctor who has switched off', async () => {
    const { lab, patient, senior } = await market();
    await h.owner.query(
      'UPDATE identity_doctor_profiles SET accepting_cases = false WHERE user_id = $1',
      [senior],
    );
    const caseId = await submitted(lab, patient);

    await expect(
      runWithContext(ctx(lab, 'libya_doctor'), () => cases.quote(caseId, senior)),
    ).rejects.toThrow(/not accepting/i);
    expect(await statusOf(caseId)).toBe('submitted');
  });

  /**
   * An unverified doctor may not receive imaging at all (Chapter V restricted
   * transfer), so being switched on is not enough to be quotable. If this ever
   * passes, a lab can route a study to a doctor ops never cleared.
   */
  it('cannot quote against an unverified doctor, however available they are', async () => {
    const { doctorId } = await createPractice(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctorId);
    await seedAcceptingDoctors(h.owner, { specialty: 'radiology', count: 5 });
    const unverified = await seedDoctor(h.owner, {
      specialty: 'radiology',
      accepting: true,
      verified: false,
    });
    const caseId = await submitted(doctorId, patient);

    await expect(
      runWithContext(ctx(doctorId, 'libya_doctor'), () => cases.quote(caseId, unverified)),
    ).rejects.toThrow(/not accepting/i);
  });

  /**
   * A decline sends the case back to the lab, and the next doctor may sit on a
   * different tier — so the re-pick is re-quoted rather than inheriting a price
   * that was computed against someone else's multiplier.
   */
  it('re-quotes on a re-pick after a decline, at the new doctor\'s tier', async () => {
    const { lab, patient, senior } = await market();
    const caseId = await submitted(lab, patient);
    await runWithContext(ctx(lab, 'libya_doctor'), () => cases.quote(caseId, senior));
    await runWithContext(ctx(lab, 'libya_doctor'), () => cases.markPaid(caseId));
    await runWithContext(ctx(senior, 'tunisia_doctor'), () => cases.decline(caseId));
    expect(await statusOf(caseId)).toBe('declined');

    const standard = await seedDoctor(h.owner, {
      specialty: 'radiology',
      tier: 'standard',
      accepting: true,
    });
    const requoted = await runWithContext(ctx(lab, 'libya_doctor'), () =>
      cases.quote(caseId, standard),
    );

    expect(requoted.status).toBe('quoted');
    expect(requoted.doctorId).toBe(standard);
    expect(requoted.quotedAmountMinor).toBe(4000); // 4000 x 1.00 x 1.00
  });

  it('will not re-quote a case that is already paid for', async () => {
    const { lab, patient, senior } = await market();
    const caseId = await submitted(lab, patient);
    await runWithContext(ctx(lab, 'libya_doctor'), () => cases.quote(caseId, senior));
    await runWithContext(ctx(lab, 'libya_doctor'), () => cases.markPaid(caseId));

    await expect(
      runWithContext(ctx(lab, 'libya_doctor'), () => cases.quote(caseId, senior)),
    ).rejects.toThrow(/cannot be quoted/i);
  });
});

describe('the receiving doctor answers', () => {
  async function paidCase(): Promise<{ referrer: string; tunis: string; caseId: string }> {
    const { doctorId: referrer } = await createPractice(h.owner, 'libya_doctor');
    const tunis = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, referrer);
    const caseId = await createCase(h.owner, patient, tunis, 'paid');
    return { referrer, tunis, caseId };
  }

  it('a doctor reading their case gets age and sex, and never a name', async () => {
    const { referrer, tunis, caseId } = await paidCase();
    // paidCase() creates the patient but no consent; the projection needs one.
    const { rows } = await h.owner.query<{ patient_id: string }>(
      'SELECT patient_id FROM cases_cases WHERE id = $1',
      [caseId],
    );
    const patientId = rows[0]?.patient_id;
    if (patientId === undefined) throw new Error('no patient on the fixture case');
    await grantConsent(h.owner, patientId, tunis, referrer);
    await runWithContext(ctx(tunis, 'tunisia_doctor'), () => cases.accept(caseId));

    const summary = await runWithContext(ctx(tunis, 'tunisia_doctor'), () =>
      cases.getCase(caseId),
    );

    expect(summary.patientName).toBeNull();
    expect(summary.patientAgeYears).toBeGreaterThan(0);
    expect(summary.patientSex).not.toBeNull();
  });

  it('accepting moves a paid case to accepted', async () => {
    const { tunis, caseId } = await paidCase();
    await runWithContext(ctx(tunis, 'tunisia_doctor'), () => cases.accept(caseId));
    expect(await statusOf(caseId)).toBe('accepted');
  });

  it('accepting starts the answer clock', async () => {
    const { tunis, caseId } = await paidCase();
    await runWithContext(ctx(tunis, 'tunisia_doctor'), () => cases.accept(caseId));

    const { rows } = await h.owner.query<{ accepted_at: Date | null; answer_due_at: Date | null }>(
      'SELECT accepted_at, answer_due_at FROM cases_cases WHERE id = $1',
      [caseId],
    );
    expect(rows[0]?.accepted_at).not.toBeNull();
    expect(rows[0]?.answer_due_at).not.toBeNull();
  });

  it('declining writes declined, not cancelled', async () => {
    // The referring lab reads them differently: a refusal means pick another
    // doctor, a cancellation is their own withdrawal.
    const { tunis, caseId } = await paidCase();
    await runWithContext(ctx(tunis, 'tunisia_doctor'), () => cases.decline(caseId));
    expect(await statusOf(caseId)).toBe('declined');
  });

  it('does not accept a case that was already declined', async () => {
    const { tunis, caseId } = await paidCase();
    await runWithContext(ctx(tunis, 'tunisia_doctor'), () => cases.decline(caseId));
    await expect(
      runWithContext(ctx(tunis, 'tunisia_doctor'), () => cases.accept(caseId)),
    ).rejects.toThrow(/not found/i);
    expect(await statusOf(caseId)).toBe('declined');
  });

  it('emits CaseAccepted once, so a repeated accept sends one notification', async () => {
    // The status guard is what makes this idempotent: a second accept matches
    // no row, so no second event is published.
    const { tunis, caseId } = await paidCase();
    const seen: string[] = [];
    bus.subscribe('CaseAccepted', (e) => {
      seen.push(e.caseId);
    });

    await runWithContext(ctx(tunis, 'tunisia_doctor'), () => cases.accept(caseId));
    await expect(
      runWithContext(ctx(tunis, 'tunisia_doctor'), () => cases.accept(caseId)),
    ).rejects.toThrow(/not found/i);

    expect(seen).toEqual([caseId]);
  });

  it('emits CaseDeclined so the lab learns to pick again', async () => {
    const { tunis, caseId } = await paidCase();
    const seen: string[] = [];
    bus.subscribe('CaseDeclined', (e) => {
      seen.push(e.caseId);
    });

    await runWithContext(ctx(tunis, 'tunisia_doctor'), () => cases.decline(caseId));
    expect(seen).toEqual([caseId]);
  });

  it("keeps one doctor's case out of another's reach", async () => {
    const { caseId } = await paidCase();
    const other = await createUser(h.owner, 'tunisia_doctor');
    await expect(
      runWithContext(ctx(other, 'tunisia_doctor'), () => cases.accept(caseId)),
    ).rejects.toThrow(/not found/i);
  });
});
