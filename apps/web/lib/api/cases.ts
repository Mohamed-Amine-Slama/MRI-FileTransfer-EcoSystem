import type {
  Case,
  CaseAudience,
  CaseEvent,
  CaseSide,
  CaseStatus,
  FileAccessEvent,
  LedgerEntry,
  Message,
  Notification,
  Provider,
  ProviderKind,
} from '@mir/contracts';

/**
 * The case-layer API surface.
 *
 * One interface, two implementations. Screens import `casesApi` and never learn
 * which one they got, so replacing fixtures with the real client is a change to
 * this file alone.
 */

export interface ListCasesQuery {
  providerId: string;
  status?: CaseStatus;
  /** Matches on case reference — the §5.3 provider search. */
  search?: string;
  /**
   * Inclusive date bounds on the case's last update, as YYYY-MM-DD — §5.3 P1
   * ("by status, date, reference number").
   *
   * A DATE and not an instant: a clinic filters by the day something happened,
   * and comparing against a timestamp would silently exclude everything that
   * happened later on the closing day.
   */
  updatedFrom?: string;
  updatedTo?: string;
}

export interface SubmitCaseInput {
  providerId: string;
  corridorId: string;
  patientId: string;
  /** Values keyed by the corridor's intakeFields (§4.3). */
  intake: Record<string, unknown>;
}

export interface RegisterProviderInput {
  kind: ProviderKind;
  legalName: string;
  corridorId: string;
  side: 'source' | 'destination';
  credentials: Record<string, unknown>;
  seatCount: number;
}

/** A draft case held locally until submitted (§5.2 P1). */
export interface CaseDraft {
  corridorId: string;
  patientId: string;
  intake: Record<string, unknown>;
  savedAt: string;
}

/**
 * What an implementation can actually do. The live API has no messaging,
 * per-file access trail, in-app notifications, or ops status override yet, so
 * screens hide those panels rather than show a thread that vanishes on reload
 * (spec 2026-09-21 D7).
 */
export interface CasesApiSupports {
  messaging: boolean;
  fileAccessTrail: boolean;
  notifications: boolean;
  statusOverride: boolean;
}

export interface CasesApi {
  readonly supports: CasesApiSupports;
  listCases(query: ListCasesQuery): Promise<Case[]>;
  /**
   * Returns null both for "no such case" and for "not yours" — §5.4 P0.
   *
   * The two are deliberately indistinguishable to the caller. A distinct
   * "exists but forbidden" answer would confirm that a guessed reference is
   * real, which is a disclosure in itself on references as short as
   * MIR-2026-0417.
   */
  getCase(ref: string, audience: CaseAudience): Promise<Case | null>;
  listCaseEvents(ref: string, audience: CaseAudience): Promise<CaseEvent[]>;
  /**
   * Who opened which file and when — §5.4 P1 and §4.4's requirement that
   * audit-relevant actions be surfaced back to the user. Scoped like every
   * other case read: the trail is as sensitive as the file it describes.
   */
  listFileAccess(ref: string, audience: CaseAudience): Promise<FileAccessEvent[]>;
  submitCase(input: SubmitCaseInput): Promise<Case>;
  /** §5.8 ops intervention. Rejects an illegal transition rather than coercing it. */
  changeCaseStatus(ref: string, to: CaseStatus, actorDisplayName: string): Promise<Case>;

  listLedger(providerId: string): Promise<LedgerEntry[]>;
  listAllLedger(): Promise<{ providerId: string; entries: LedgerEntry[] }[]>;

  listMessages(ref: string, audience: CaseAudience): Promise<Message[]>;
  /**
   * The author's SIDE is a parameter, not something the implementation
   * assumes. A thread whose whole job is telling the two clinics apart cannot
   * have the sender's identity inferred by the layer writing the row.
   */
  sendMessage(
    ref: string,
    body: string,
    authorDisplayName: string,
    authorSide: CaseSide,
  ): Promise<Message>;

  /**
   * Scoped like every other case read. A notification names a case reference,
   * so an unscoped list would leak which cases exist to whoever asked — the
   * same disclosure `getCase` is careful to avoid, arriving by a side door.
   */
  listNotifications(audience: CaseAudience): Promise<Notification[]>;
  markNotificationRead(id: string): Promise<void>;

  getProvider(id: string): Promise<Provider | null>;
  listProviders(): Promise<Provider[]>;
  listVerificationQueue(): Promise<Provider[]>;
  registerProvider(input: RegisterProviderInput): Promise<Provider>;
  decideVerification(id: string, approve: boolean, reasonKey?: string): Promise<Provider>;

  /** §5.8: the ops pipeline across all providers, not one provider's list. */
  listAllCases(status?: CaseStatus): Promise<Case[]>;
}

/**
 * Defaults to LIVE. A missing or misspelled environment variable must never
 * silently serve fixtures to a clinic — the failure mode of the opposite
 * default is invented patients on a real screen.
 */
export function isMockMode(): boolean {
  return process.env.NEXT_PUBLIC_MIR_API_MODE === 'mock';
}
