import {
  caseEventSchema,
  caseSchema,
  fileAccessEventSchema,
  ledgerEntrySchema,
  messageSchema,
  notificationSchema,
  providerSchema,
  type Case,
  type CaseEvent,
  type FileAccessEvent,
  type LedgerEntry,
  type Message,
  type Notification,
  type Provider,
} from '@mir/contracts';
import { DEFAULT_CORRIDOR_ID } from '../../corridor/registry';

/**
 * Synthetic fixtures.
 *
 * Every record is parsed through its schema at module load, so a fixture that
 * drifts from the contract fails the test run rather than teaching a screen to
 * render a shape the real API will never send.
 *
 * Everything here is invented. This repo has a `check:synthetic` gate, and
 * nothing in these fixtures may resemble real patient data.
 */

export const FIXTURE_PROVIDERS: readonly Provider[] = [
  providerSchema.parse({
    id: 'prov-source-1',
    kind: 'clinic',
    legalName: 'Andalus Diagnostic Centre',
    corridorId: DEFAULT_CORRIDOR_ID,
    side: 'source',
    verification: {
      status: 'approved',
      submittedAt: '2026-06-01T09:00:00.000Z',
      decidedAt: '2026-06-03T10:00:00.000Z',
      credentials: { licenceNumber: 'LY-88213' },
    },
    seatCount: 4,
  }),
  providerSchema.parse({
    id: 'prov-source-2',
    kind: 'laboratory',
    legalName: 'Sabratha Medical Laboratory',
    corridorId: DEFAULT_CORRIDOR_ID,
    side: 'source',
    verification: {
      status: 'pending',
      submittedAt: '2026-08-20T09:00:00.000Z',
      credentials: { licenceNumber: 'LY-90114' },
    },
    seatCount: 2,
  }),
  providerSchema.parse({
    id: 'prov-dest-1',
    kind: 'clinic',
    legalName: 'Clinique Les Oliviers',
    corridorId: DEFAULT_CORRIDOR_ID,
    side: 'destination',
    verification: {
      status: 'approved',
      submittedAt: '2026-05-11T09:00:00.000Z',
      decidedAt: '2026-05-12T14:00:00.000Z',
      credentials: { cnomNumber: 'TN-4471' },
    },
    seatCount: 6,
  }),
];

export const FIXTURE_CASES: readonly Case[] = [
  caseSchema.parse({
    ref: 'MIR-2026-0417',
    corridorId: DEFAULT_CORRIDOR_ID,
    status: 'accepted',
    submittedByProviderId: 'prov-source-1',
    matchedProviderId: 'prov-dest-1',
    patientId: 'pat-fixture-1',
    studyIds: ['study-fixture-1'],
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-06T11:30:00.000Z',
    intake: { referralReason: 'Suspected meniscal tear', urgency: 'soon' },
  }),
  caseSchema.parse({
    ref: 'MIR-2026-0418',
    corridorId: DEFAULT_CORRIDOR_ID,
    status: 'submitted',
    submittedByProviderId: 'prov-source-1',
    patientId: 'pat-fixture-2',
    studyIds: [],
    createdAt: '2026-08-24T08:15:00.000Z',
    updatedAt: '2026-08-24T08:15:00.000Z',
    intake: { referralReason: 'Persistent headache, MRI requested', urgency: 'routine' },
  }),
  caseSchema.parse({
    ref: 'MIR-2026-0402',
    corridorId: DEFAULT_CORRIDOR_ID,
    status: 'answered',
    submittedByProviderId: 'prov-source-1',
    matchedProviderId: 'prov-dest-1',
    patientId: 'pat-fixture-3',
    studyIds: ['study-fixture-2', 'study-fixture-3'],
    createdAt: '2026-07-02T10:00:00.000Z',
    updatedAt: '2026-07-29T16:45:00.000Z',
    intake: { referralReason: 'Post-operative follow-up', urgency: 'routine' },
  }),
];

export const FIXTURE_EVENTS: readonly CaseEvent[] = [
  caseEventSchema.parse({
    id: 'ev-1',
    caseRef: 'MIR-2026-0417',
    occurredAt: '2026-08-01T09:00:00.000Z',
    actorDisplayName: 'Andalus Diagnostic Centre',
    actorSide: 'source',
    from: null,
    to: 'submitted',
  }),
  caseEventSchema.parse({
    id: 'ev-2',
    caseRef: 'MIR-2026-0417',
    occurredAt: '2026-08-02T13:20:00.000Z',
    actorDisplayName: 'Andalus Diagnostic Centre',
    actorSide: 'source',
    from: 'submitted',
    to: 'quoted',
  }),
  caseEventSchema.parse({
    id: 'ev-3',
    caseRef: 'MIR-2026-0417',
    occurredAt: '2026-08-03T08:40:00.000Z',
    actorDisplayName: 'Andalus Diagnostic Centre',
    actorSide: 'source',
    from: 'quoted',
    to: 'paid',
  }),
  caseEventSchema.parse({
    id: 'ev-4',
    caseRef: 'MIR-2026-0417',
    occurredAt: '2026-08-06T11:30:00.000Z',
    actorDisplayName: 'Clinique Les Oliviers',
    actorSide: 'destination',
    from: 'paid',
    to: 'accepted',
  }),
];

export const FIXTURE_LEDGER: readonly LedgerEntry[] = [
  ledgerEntrySchema.parse({
    kind: 'coordination_fee',
    id: 'led-1',
    caseRef: 'MIR-2026-0402',
    occurredAt: '2026-07-29T16:45:00.000Z',
    amount: { amountMinor: 25000, currency: 'USD' },
    status: 'paid',
  }),
  ledgerEntrySchema.parse({
    kind: 'coordination_fee',
    id: 'led-2',
    caseRef: 'MIR-2026-0417',
    occurredAt: '2026-08-06T11:30:00.000Z',
    amount: { amountMinor: 25000, currency: 'USD' },
    status: 'pending',
  }),
  ledgerEntrySchema.parse({
    kind: 'saas_subscription',
    id: 'led-3',
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-08-31T23:59:59.000Z',
    occurredAt: '2026-08-01T00:00:00.000Z',
    amount: { amountMinor: 9900, currency: 'EUR' },
    status: 'overdue',
  }),
];

export const FIXTURE_MESSAGES: readonly Message[] = [
  messageSchema.parse({
    id: 'msg-1',
    caseRef: 'MIR-2026-0417',
    authorSide: 'source',
    authorDisplayName: 'Dr. Amal Ben Salah',
    body: 'Films uploaded. Please confirm they are readable.',
    sentAt: '2026-08-04T11:30:00.000Z',
    deliveredAt: '2026-08-04T11:30:05.000Z',
    readAt: '2026-08-04T12:02:00.000Z',
  }),
  messageSchema.parse({
    id: 'msg-2',
    caseRef: 'MIR-2026-0417',
    authorSide: 'destination',
    authorDisplayName: 'Dr. Youssef Trabelsi',
    body: 'Received and readable. Booking the consultation for next week.',
    sentAt: '2026-08-04T12:10:00.000Z',
    deliveredAt: '2026-08-04T12:10:03.000Z',
  }),
];

export const FIXTURE_NOTIFICATIONS: readonly Notification[] = [
  notificationSchema.parse({
    id: 'notif-1',
    kind: 'message_received',
    caseRef: 'MIR-2026-0417',
    occurredAt: '2026-08-04T12:10:03.000Z',
    titleKey: 'notifMessageReceived',
  }),
  notificationSchema.parse({
    id: 'notif-2',
    kind: 'case_status_changed',
    caseRef: 'MIR-2026-0417',
    occurredAt: '2026-08-06T11:30:00.000Z',
    titleKey: 'notifCaseStatusChanged',
    readAt: '2026-08-06T12:00:00.000Z',
  }),
];

/**
 * §5.4 P1: the access trail behind "last accessed by Dr. X on [date]".
 *
 * Deliberately includes an access by the RECEIVING clinic to a study the
 * referring clinic uploaded, because that is the reassurance the trail exists
 * to give: the films arrived and somebody actually opened them.
 */
export const FIXTURE_FILE_ACCESS: readonly FileAccessEvent[] = [
  fileAccessEventSchema.parse({
    id: 'fa-1',
    caseRef: 'MIR-2026-0417',
    studyId: 'study-fixture-1',
    actorDisplayName: 'Dr. Amal Ben Salah',
    actorSide: 'source',
    action: 'uploaded',
    occurredAt: '2026-08-04T11:28:00.000Z',
  }),
  fileAccessEventSchema.parse({
    id: 'fa-2',
    caseRef: 'MIR-2026-0417',
    studyId: 'study-fixture-1',
    actorDisplayName: 'Dr. Youssef Trabelsi',
    actorSide: 'destination',
    action: 'viewed',
    occurredAt: '2026-08-04T12:05:00.000Z',
  }),
  fileAccessEventSchema.parse({
    id: 'fa-3',
    caseRef: 'MIR-2026-0402',
    studyId: 'study-fixture-2',
    actorDisplayName: 'Dr. Youssef Trabelsi',
    actorSide: 'destination',
    action: 'downloaded',
    occurredAt: '2026-07-28T09:15:00.000Z',
  }),
];
