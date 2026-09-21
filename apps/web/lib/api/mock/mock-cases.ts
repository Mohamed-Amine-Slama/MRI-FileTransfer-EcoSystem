import {
  canTransition,
  canViewCase,
  caseEventSchema,
  caseSchema,
  formatCaseRef,
  messageSchema,
  providerSchema,
  type Case,
  type CaseAudience,
  type CaseEvent,
  type CaseSide,
  type CaseStatus,
  type FileAccessEvent,
  type LedgerEntry,
  type Message,
  type Notification,
  type Provider,
} from '@mir/contracts';
import type {
  CasesApi,
  ListCasesQuery,
  RegisterProviderInput,
  SubmitCaseInput,
} from '../cases';
import {
  FIXTURE_CASES,
  FIXTURE_EVENTS,
  FIXTURE_FILE_ACCESS,
  FIXTURE_LEDGER,
  FIXTURE_MESSAGES,
  FIXTURE_NOTIFICATIONS,
  FIXTURE_PROVIDERS,
} from './fixtures';

/**
 * Fixture-backed implementation of CasesApi.
 *
 * Async on purpose even though nothing awaits: screens written against this
 * must handle loading states, or every one of them needs rewriting the day the
 * real client lands.
 *
 * Mutations are held in module-level arrays seeded from the fixtures. They
 * survive client-side navigation and are lost on reload, which is the right
 * lifetime for a development stand-in — nothing here may look like durable
 * storage, because a screen that appears to persist would hide the fact that
 * the write path does not exist yet.
 *
 * The provider filter mirrors what the backend's RLS will enforce. It is here
 * so a screen developed against mocks cannot accidentally come to rely on
 * seeing another provider's cases.
 */

const cases: Case[] = [...FIXTURE_CASES];
const events: CaseEvent[] = [...FIXTURE_EVENTS];
const messages: Message[] = [...FIXTURE_MESSAGES];
const notifications: Notification[] = [...FIXTURE_NOTIFICATIONS];
const providers: Provider[] = [...FIXTURE_PROVIDERS];
const fileAccess: FileAccessEvent[] = [...FIXTURE_FILE_ACCESS];

/**
 * The provider filter mirrors what RLS will enforce, and it is the CONTRACT's
 * predicate rather than a second copy of the rule — a mock that is more
 * permissive than the database teaches screens to rely on rows they will never
 * receive in production.
 */
function visibleTo(item: Case, providerId: string): boolean {
  return canViewCase(item, { kind: 'provider', providerId });
}

/** Resolves a case only if the asker is entitled to it (§5.4 P0). */
function findVisible(ref: string, audience: CaseAudience): Case | null {
  const found = cases.find((c) => c.ref === ref);
  if (found === undefined) return null;
  return canViewCase(found, audience) ? found : null;
}

/**
 * Inclusive day-boundary comparison for the §5.3 date filter.
 *
 * Compares the DATE PART as a string. `2026-08-06T11:30:00Z` and the bound
 * `2026-08-06` compare equal, so a case updated in the afternoon is included
 * by a filter that ends on its own day — which is what "up to the 6th" means
 * to the person typing it, and what a naive `Date.parse(bound)` comparison
 * against midnight would get wrong.
 */
function withinDates(timestamp: string, from?: string, to?: string): boolean {
  const day = timestamp.slice(0, 10);
  if (from !== undefined && from !== '' && day < from) return false;
  if (to !== undefined && to !== '' && day > to) return false;
  return true;
}

/** Next free sequence for the current year, so references never collide. */
function nextRef(): string {
  const year = new Date().getUTCFullYear();
  const used = cases
    .map((c) => c.ref)
    .filter((ref) => ref.startsWith(`MIR-${year}-`))
    .map((ref) => Number(ref.slice(-4)));
  return formatCaseRef(year, Math.max(0, ...used) + 1);
}

function requireCase(ref: string): Case {
  const found = cases.find((c) => c.ref === ref);
  if (found === undefined) throw new Error(`no such case: ${ref}`);
  return found;
}

export const mockCasesApi: CasesApi = {
  // The fixture store implements everything, which is what the screens were
  // built and reviewed against.
  supports: { messaging: true, fileAccessTrail: true, notifications: true, statusOverride: true },

  async listCases(query: ListCasesQuery): Promise<Case[]> {
    return cases.filter(
      (c) =>
        visibleTo(c, query.providerId) &&
        (query.status === undefined || c.status === query.status) &&
        (query.search === undefined ||
          query.search === '' ||
          c.ref.toLowerCase().includes(query.search.toLowerCase())) &&
        withinDates(c.updatedAt, query.updatedFrom, query.updatedTo),
    );
  },

  async getCase(ref: string, audience: CaseAudience): Promise<Case | null> {
    return findVisible(ref, audience);
  },

  async listCaseEvents(ref: string, audience: CaseAudience): Promise<CaseEvent[]> {
    // Gated on the case, not on the events: a timeline is as sensitive as the
    // case it describes, and leaking one is leaking the other.
    if (findVisible(ref, audience) === null) return [];
    return events
      .filter((e) => e.caseRef === ref)
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  },

  async listFileAccess(ref: string, audience: CaseAudience): Promise<FileAccessEvent[]> {
    if (findVisible(ref, audience) === null) return [];
    return fileAccess
      .filter((e) => e.caseRef === ref)
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  },

  async submitCase(input: SubmitCaseInput): Promise<Case> {
    const now = new Date().toISOString();
    const created = caseSchema.parse({
      ref: nextRef(),
      corridorId: input.corridorId,
      status: 'submitted',
      submittedByProviderId: input.providerId,
      patientId: input.patientId,
      studyIds: [],
      createdAt: now,
      updatedAt: now,
      intake: input.intake,
    });
    cases.unshift(created);
    events.push(
      caseEventSchema.parse({
        id: `ev-${created.ref}-1`,
        caseRef: created.ref,
        occurredAt: now,
        actorDisplayName: providers.find((p) => p.id === input.providerId)?.legalName ?? 'Provider',
        actorSide: 'source',
        from: null,
        to: 'submitted',
      }),
    );
    return created;
  },

  async changeCaseStatus(ref: string, to: CaseStatus, actorDisplayName: string): Promise<Case> {
    const existing = requireCase(ref);
    // Refused rather than coerced: an ops tool that can force any status is a
    // tool that can silently undo a coordination fee (§5.7).
    if (!canTransition(existing.status, to)) {
      throw new Error(`illegal transition: ${existing.status} -> ${to}`);
    }
    const now = new Date().toISOString();
    events.push(
      caseEventSchema.parse({
        id: `ev-${ref}-${events.filter((e) => e.caseRef === ref).length + 1}`,
        caseRef: ref,
        occurredAt: now,
        actorDisplayName,
        actorSide: 'ops',
        from: existing.status,
        to,
      }),
    );
    const updated: Case = { ...existing, status: to, updatedAt: now };
    cases[cases.indexOf(existing)] = updated;
    return updated;
  },

  async listLedger(providerId: string): Promise<LedgerEntry[]> {
    // The fixtures model a single billed provider; the argument is kept so the
    // signature matches the real client exactly.
    return providerId === 'prov-source-1' ? FIXTURE_LEDGER.slice() : [];
  },

  async listAllLedger(): Promise<{ providerId: string; entries: LedgerEntry[] }[]> {
    return providers.map((p) => ({
      providerId: p.id,
      entries: p.id === 'prov-source-1' ? FIXTURE_LEDGER.slice() : [],
    }));
  },

  async listMessages(ref: string, audience: CaseAudience): Promise<Message[]> {
    if (findVisible(ref, audience) === null) return [];
    return messages
      .filter((m) => m.caseRef === ref)
      .sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
  },

  async sendMessage(
    ref: string,
    body: string,
    authorDisplayName: string,
    authorSide: CaseSide,
  ): Promise<Message> {
    const now = new Date().toISOString();
    const created = messageSchema.parse({
      id: `msg-${messages.length + 1}`,
      caseRef: ref,
      authorSide,
      authorDisplayName,
      body,
      sentAt: now,
      deliveredAt: now,
    });
    messages.push(created);
    return created;
  },

  async listNotifications(audience: CaseAudience): Promise<Notification[]> {
    return notifications
      .filter((n) => findVisible(n.caseRef, audience) !== null)
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  },

  async markNotificationRead(id: string): Promise<void> {
    const index = notifications.findIndex((n) => n.id === id);
    const existing = notifications[index];
    if (existing === undefined) return;
    notifications[index] = { ...existing, readAt: new Date().toISOString() };
  },

  async getProvider(id: string): Promise<Provider | null> {
    return providers.find((p) => p.id === id) ?? null;
  },

  async listProviders(): Promise<Provider[]> {
    return providers.slice();
  },

  async listVerificationQueue(): Promise<Provider[]> {
    return providers.filter((p) => p.verification.status === 'pending');
  },

  async registerProvider(input: RegisterProviderInput): Promise<Provider> {
    const created = providerSchema.parse({
      id: `prov-${providers.length + 1}`,
      kind: input.kind,
      legalName: input.legalName,
      corridorId: input.corridorId,
      side: input.side,
      verification: {
        status: 'pending',
        submittedAt: new Date().toISOString(),
        credentials: input.credentials,
      },
      seatCount: input.seatCount,
    });
    providers.push(created);
    return created;
  },

  async decideVerification(id: string, approve: boolean, reasonKey?: string): Promise<Provider> {
    const existing = providers.find((p) => p.id === id);
    if (existing === undefined) throw new Error(`no such provider: ${id}`);
    const updated = providerSchema.parse({
      ...existing,
      verification: {
        ...existing.verification,
        status: approve ? 'approved' : 'rejected',
        decidedAt: new Date().toISOString(),
        ...(reasonKey === undefined ? {} : { reasonKey }),
      },
    });
    providers[providers.indexOf(existing)] = updated;
    return updated;
  },

  async listAllCases(status?: CaseStatus): Promise<Case[]> {
    return cases.filter((c) => status === undefined || c.status === status);
  },
};
