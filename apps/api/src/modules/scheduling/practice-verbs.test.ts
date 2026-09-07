import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import {
  runWithContext,
  systemContext,
  type RequestContext,
} from '../../shared/context/request-context';
import { DatabaseService } from '../../shared/db/database.service';
import {
  appUrl,
  createCase,
  createPatient,
  createUser,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { EventBus } from '../../shared/events/event-bus';
import { SchedulingService } from './internal/scheduling.service';
import { LedgerService } from '../ledger';

/**
 * Closing out a case: complete, cancel-with-reason, correct the detail, and the
 * expiry sweep.
 *
 * WHAT LEFT THIS FILE AND WHY. It used to cover reschedule, no-show,
 * availability upkeep, recurring rules and appointment reminders. Migration
 * 0025 removed the calendar those verbs operated on — there are no slots, so
 * nothing to move, miss, publish hours for, or remind anyone to attend. Those
 * tests were deleted rather than adapted: a test for a guarantee the system no
 * longer makes is worse than no test, because it reads as coverage.
 */

let h: Harness;
let db: DatabaseService;
let bus: EventBus;
let scheduling: SchedulingService;

const config = { CASES_ANSWER_WINDOW_HOURS: 72 } as AppConfig;

const ctx = (userId: string, role: RequestContext['role']): RequestContext => ({
  userId,
  role,
  ipAddress: '41.208.1.5',
  userAgent: 'vitest',
  requestId: 'practice-verbs',
});

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 8 } as AppConfig);
  bus = new EventBus();
  scheduling = new SchedulingService(db, bus, config, new LedgerService(db));
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

/** A receiving doctor with a case in front of them. */
async function withCase(
  status: 'paid' | 'accepted' | 'answered' = 'accepted',
): Promise<{ doctor: string; patient: string; caseId: string }> {
  const referrer = await createUser(h.owner, 'libya_doctor');
  const doctor = await createUser(h.owner, 'tunisia_doctor');
  const patient = await createPatient(h.owner, referrer);
  const caseId = await createCase(h.owner, patient, doctor, status);
  return { doctor, patient, caseId };
}

describe('closing out a case', () => {
  it('marks an accepted case answered', async () => {
    const { doctor, caseId } = await withCase('accepted');
    await runWithContext(ctx(doctor, 'tunisia_doctor'), () => scheduling.markCompleted(caseId));

    const { rows } = await h.owner.query<{ status: string }>(
      'SELECT status FROM cases_cases WHERE id = $1',
      [caseId],
    );
    expect(rows[0]?.status).toBe('answered');
  });

  it('refuses to answer a case the doctor has not accepted', async () => {
    // Paid means it is in front of them and they have not committed. Answering
    // without accepting would skip the moment imaging unlocks.
    const { doctor, caseId } = await withCase('paid');
    await expect(
      runWithContext(ctx(doctor, 'tunisia_doctor'), () => scheduling.markCompleted(caseId)),
    ).rejects.toThrow();
  });

  it('cancels with a reason the other side can act on', async () => {
    const { doctor, caseId } = await withCase('accepted');
    await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.cancelAsDoctor(caseId, 'Equipment failure'),
    );

    const { rows } = await h.owner.query<{ status: string; cancel_reason: string | null }>(
      'SELECT status, cancel_reason FROM cases_cases WHERE id = $1',
      [caseId],
    );
    expect(rows[0]?.status).toBe('cancelled');
    expect(rows[0]?.cancel_reason).toBe('Equipment failure');
  });

  it('corrects the referral detail without touching the status', async () => {
    const { doctor, caseId } = await withCase('accepted');
    await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.updateCase(caseId, { notes: 'Prior imaging attached' }),
    );

    const { rows } = await h.owner.query<{ status: string; notes: string | null }>(
      'SELECT status, notes FROM cases_cases WHERE id = $1',
      [caseId],
    );
    expect(rows[0]?.notes).toBe('Prior imaging attached');
    expect(rows[0]?.status).toBe('accepted');
  });
});

describe('the expiry sweep', () => {
  it('expires an accepted case past its deadline, exactly once', async () => {
    const { caseId } = await withCase('accepted');
    await h.owner.query(
      `UPDATE cases_cases SET answer_due_at = now() - interval '1 hour' WHERE id = $1`,
      [caseId],
    );

    // The UPDATE is the guard, not a select-then-update: two sweeps running
    // together must not both refund the same case.
    expect(await runWithContext(systemContext('cases-sweep'), () => scheduling.expireOverdue())).toBe(1);
    expect(await runWithContext(systemContext('cases-sweep'), () => scheduling.expireOverdue())).toBe(0);

    const { rows } = await h.owner.query<{ status: string }>(
      'SELECT status FROM cases_cases WHERE id = $1',
      [caseId],
    );
    expect(rows[0]?.status).toBe('expired');
  });

  it('leaves a case still inside its window alone', async () => {
    const { caseId } = await withCase('accepted');
    await h.owner.query(
      `UPDATE cases_cases SET answer_due_at = now() + interval '1 hour' WHERE id = $1`,
      [caseId],
    );
    expect(await runWithContext(systemContext('cases-sweep'), () => scheduling.expireOverdue())).toBe(0);
  });

  it('never expires a case the doctor has not accepted', async () => {
    // An unaccepted case has no clock running: nobody has promised anything,
    // so there is nothing to expire and nothing to refund.
    const { caseId } = await withCase('paid');
    await h.owner.query(
      `UPDATE cases_cases SET answer_due_at = now() - interval '1 hour' WHERE id = $1`,
      [caseId],
    );
    expect(await runWithContext(systemContext('cases-sweep'), () => scheduling.expireOverdue())).toBe(0);
  });
});
