import { describe, expect, it } from 'vitest';
import { canTransition, summariseLedger, type CaseAudience } from '@mir/contracts';

/** The two audiences the screens actually pass (§5.4 P0). */
const SOURCE: CaseAudience = { kind: 'provider', providerId: 'prov-source-1' };
const OPS: CaseAudience = { kind: 'ops' };
import { mockCasesApi } from './mock-cases';

describe('mock cases api', () => {
  it('lists cases visible to a side, and never cases from another provider', async () => {
    const all = await mockCasesApi.listCases({ providerId: 'prov-source-1' });
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) {
      expect([c.submittedByProviderId, c.matchedProviderId]).toContain('prov-source-1');
    }
  });

  it('filters by status, for the §5.3 provider case list', async () => {
    const completed = await mockCasesApi.listCases({
      providerId: 'prov-source-1',
      status: 'answered',
    });
    expect(completed.length).toBeGreaterThan(0);
    for (const c of completed) {
      expect(c.status).toBe('answered');
    }
  });

  it('finds a case by its reference number, the way a provider searches (§5.3)', async () => {
    const [first] = await mockCasesApi.listCases({ providerId: 'prov-source-1' });
    expect(first).toBeDefined();
    if (first === undefined) return;
    const found = await mockCasesApi.getCase(first.ref, SOURCE);
    expect(found?.ref).toBe(first.ref);
  });

  it('returns null for an unknown reference rather than throwing', async () => {
    expect(await mockCasesApi.getCase('MIR-1999-0001', SOURCE)).toBeNull();
  });

  it('returns a timeline whose transitions are all legal (§5.3)', async () => {
    const events = await mockCasesApi.listCaseEvents('MIR-2026-0417', SOURCE);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      if (event.from !== null) {
        expect(canTransition(event.from, event.to)).toBe(true);
      }
    }
  });

  it('orders the timeline oldest first, so a history reads downward', async () => {
    const events = await mockCasesApi.listCaseEvents('MIR-2026-0417', SOURCE);
    const times = events.map((e) => Date.parse(e.occurredAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('serves a ledger that summarises into separate fee kinds (§5.7)', async () => {
    const entries = await mockCasesApi.listLedger('prov-source-1');
    const summary = summariseLedger(entries);
    expect(Object.keys(summary.coordinationFees).length).toBeGreaterThan(0);
    expect(Object.keys(summary.subscriptions).length).toBeGreaterThan(0);
  });

  it('scopes messages to one case (§5.6)', async () => {
    const messages = await mockCasesApi.listMessages('MIR-2026-0417', SOURCE);
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message.caseRef).toBe('MIR-2026-0417');
    }
  });

  it('reports the verification state a provider must see for themselves (§5.1)', async () => {
    const pending = await mockCasesApi.getProvider('prov-source-2');
    expect(pending?.verification.status).toBe('pending');
  });

  it('lists the admin approval queue as pending providers only (§5.1, §5.8)', async () => {
    const queue = await mockCasesApi.listVerificationQueue();
    expect(queue.length).toBeGreaterThan(0);
    for (const provider of queue) {
      expect(provider.verification.status).toBe('pending');
    }
  });

  it('serves the ops pipeline across all providers, not one provider list (§5.8)', async () => {
    const all = await mockCasesApi.listAllCases();
    const mine = await mockCasesApi.listCases({ providerId: 'prov-source-1' });
    expect(all.length).toBeGreaterThanOrEqual(mine.length);
  });
});

describe('mock cases api mutations', () => {
  it('assigns a fresh reference on submission and opens the timeline (§5.2)', async () => {
    const created = await mockCasesApi.submitCase({
      providerId: 'prov-source-1',
      corridorId: 'ly-tn',
      patientId: 'pat-new',
      intake: { referralReason: 'New referral', urgency: 'routine' },
    });
    expect(created.ref).toMatch(/^MIR-\d{4}-\d{4}$/);
    expect(created.status).toBe('submitted');

    const events = await mockCasesApi.listCaseEvents(created.ref, SOURCE);
    expect(events).toHaveLength(1);
    expect(events[0]?.from).toBeNull();
    expect(events[0]?.to).toBe('submitted');
  });

  it('never reuses a reference', async () => {
    const a = await mockCasesApi.submitCase({
      providerId: 'prov-source-1',
      corridorId: 'ly-tn',
      patientId: 'pat-a',
      intake: {},
    });
    const b = await mockCasesApi.submitCase({
      providerId: 'prov-source-1',
      corridorId: 'ly-tn',
      patientId: 'pat-b',
      intake: {},
    });
    expect(a.ref).not.toBe(b.ref);
  });

  it('refuses an illegal ops status override rather than coercing it (§5.8)', async () => {
    await expect(
      mockCasesApi.changeCaseStatus('MIR-2026-0418', 'answered', 'Ops'),
    ).rejects.toThrow(/illegal transition/);
  });

  it('records who moved a case and when, for the §5.3 timeline', async () => {
    const before = await mockCasesApi.listCaseEvents('MIR-2026-0418', SOURCE);
    await mockCasesApi.changeCaseStatus('MIR-2026-0418', 'quoted', 'Ops staff');
    const after = await mockCasesApi.listCaseEvents('MIR-2026-0418', SOURCE);
    expect(after.length).toBe(before.length + 1);
    expect(after.at(-1)?.actorDisplayName).toBe('Ops staff');
  });

  it('appends a message to the case it was sent on (§5.6)', async () => {
    const created = await mockCasesApi.sendMessage(
      'MIR-2026-0417',
      'Following up.',
      'Dr. Amal',
      'source',
    );
    expect(created.caseRef).toBe('MIR-2026-0417');
    const all = await mockCasesApi.listMessages('MIR-2026-0417', SOURCE);
    expect(all.at(-1)?.body).toBe('Following up.');
  });

  it('attributes a message to the side that actually sent it (§5.6)', async () => {
    // Hardcoding the author side would label the receiving clinic's own reply
    // as coming from the referring clinic — on a thread whose entire purpose
    // is telling the two parties apart.
    const created = await mockCasesApi.sendMessage(
      'MIR-2026-0417',
      'Scheduling the consultation.',
      'Dr. Youssef',
      'destination',
    );
    expect(created.authorSide).toBe('destination');
  });

  it('marks a notification read without disturbing the others (§5.6)', async () => {
    const before = await mockCasesApi.listNotifications(SOURCE);
    const unread = before.find((n) => n.readAt === undefined);
    expect(unread).toBeDefined();
    if (unread === undefined) return;
    await mockCasesApi.markNotificationRead(unread.id);
    const after = await mockCasesApi.listNotifications(SOURCE);
    expect(after.find((n) => n.id === unread.id)?.readAt).toBeDefined();
    expect(after).toHaveLength(before.length);
  });

  it('registers a provider as pending, never pre-approved (§5.1)', async () => {
    const created = await mockCasesApi.registerProvider({
      kind: 'clinic',
      legalName: 'New Clinic',
      corridorId: 'ly-tn',
      side: 'source',
      credentials: { licenceNumber: 'X-1' },
      seatCount: 1,
    });
    expect(created.verification.status).toBe('pending');
    expect(created.verification.decidedAt).toBeUndefined();
  });

  it('records a decision instant when ops approves or rejects (§5.1)', async () => {
    const created = await mockCasesApi.registerProvider({
      kind: 'doctor',
      legalName: 'Solo Practice',
      corridorId: 'ly-tn',
      side: 'destination',
      credentials: {},
      seatCount: 1,
    });
    const rejected = await mockCasesApi.decideVerification(
      created.id,
      false,
      'verificationReasonLicenceExpired',
    );
    expect(rejected.verification.status).toBe('rejected');
    expect(rejected.verification.decidedAt).toBeDefined();
    expect(rejected.verification.reasonKey).toBe('verificationReasonLicenceExpired');
  });
});

describe('case reads are scoped to the parties (§5.4 P0, §4.4)', () => {
  it('hides another provider’s case behind the same answer as a bad reference', async () => {
    const stranger: CaseAudience = { kind: 'provider', providerId: 'prov-stranger' };
    expect(await mockCasesApi.getCase('MIR-2026-0417', stranger)).toBeNull();
    expect(await mockCasesApi.getCase('MIR-9999-0001', stranger)).toBeNull();
  });

  it('withholds the timeline and the thread too, not just the case row', async () => {
    // The history and the messages describe the case as completely as the case
    // does. Gating only the top-level read would leak both.
    const stranger: CaseAudience = { kind: 'provider', providerId: 'prov-stranger' };
    expect(await mockCasesApi.listCaseEvents('MIR-2026-0417', stranger)).toEqual([]);
    expect(await mockCasesApi.listMessages('MIR-2026-0417', stranger)).toEqual([]);
  });

  it('does not leak which cases exist through the notification list', async () => {
    // A notification names a case reference. Listing them unscoped would tell
    // a stranger which references are real — the disclosure getCase avoids.
    const stranger: CaseAudience = { kind: 'provider', providerId: 'prov-stranger' };
    expect(await mockCasesApi.listNotifications(stranger)).toEqual([]);
    expect((await mockCasesApi.listNotifications(SOURCE)).length).toBeGreaterThan(0);
  });

  it('serves ops any case, which is what §5.8 oversight requires', async () => {
    expect(await mockCasesApi.getCase('MIR-2026-0417', OPS)).not.toBeNull();
    expect((await mockCasesApi.listCaseEvents('MIR-2026-0417', OPS)).length).toBeGreaterThan(0);
  });
});

describe('case list date filtering (§5.3 P1)', () => {
  it('includes a case updated on the closing day itself', async () => {
    // MIR-2026-0417 was last updated at 11:30 on 2026-08-06. A filter ending
    // "2026-08-06" must include it — comparing against midnight would not.
    const same = await mockCasesApi.listCases({
      providerId: 'prov-source-1',
      updatedFrom: '2026-08-06',
      updatedTo: '2026-08-06',
    });
    expect(same.map((c) => c.ref)).toContain('MIR-2026-0417');
  });

  it('excludes cases outside the range', async () => {
    const older = await mockCasesApi.listCases({
      providerId: 'prov-source-1',
      updatedTo: '2026-07-31',
    });
    expect(older.map((c) => c.ref)).toContain('MIR-2026-0402');
    expect(older.map((c) => c.ref)).not.toContain('MIR-2026-0417');
  });

  it('treats an empty bound as no bound, so a cleared input does not hide rows', async () => {
    const all = await mockCasesApi.listCases({ providerId: 'prov-source-1' });
    const blank = await mockCasesApi.listCases({
      providerId: 'prov-source-1',
      updatedFrom: '',
      updatedTo: '',
    });
    expect(blank.length).toBe(all.length);
  });

  it('combines with the status filter rather than replacing it', async () => {
    const rows = await mockCasesApi.listCases({
      providerId: 'prov-source-1',
      status: 'answered',
      updatedFrom: '2026-01-01',
    });
    for (const row of rows) expect(row.status).toBe('answered');
  });
});
