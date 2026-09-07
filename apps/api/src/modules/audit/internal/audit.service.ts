import { Injectable } from '@nestjs/common';
import { DatabaseService, type Tx } from '../../../shared/db/database.service';
import type { DomainEvent } from '../../../shared/events/domain-events';

/**
 * Append-only audit log — BUILD_SPEC P4.4.
 *
 * THERE IS NO UPDATE OR DELETE PATH IN THIS CLASS. That is not an oversight to
 * be filled in later; it is the design. Immutability is enforced at three
 * levels, because any one of them can be bypassed:
 *
 *   1. Here — no method exists to modify a row.
 *   2. Database GRANTs — `mir_app` holds SELECT and INSERT on audit_events and
 *      nothing else, so even SQL injection cannot erase history (P3.2).
 *   3. Object storage — rows are archived to an Object Lock bucket, so a full
 *      database compromise still cannot rewrite the past (P2.4).
 *
 * Level 1 alone is a comment. Level 2 is the one the P3.2 tests prove.
 */

export interface AuditRecord {
  actorId: string | undefined;
  actorRole: string | undefined;
  action: string;
  subjectType: string;
  subjectId: string | undefined;
  patientId: string | undefined;
  ipAddress: string | undefined;
  userAgent: string | undefined;
  metadata: Record<string, unknown>;
}

export interface AuditEventSummary {
  id: string;
  occurredAt: Date;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string;
  outcome: 'allowed' | 'denied';
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Recent audit events, newest first — the admin review screen.
   *
   * READ-ONLY BY CONSTRUCTION. There is no update or delete counterpart in
   * this service and there cannot usefully be one: the application role holds
   * no UPDATE or DELETE grant on audit_events (migration 0002), so the
   * database would refuse. The append-only property is enforced by privilege,
   * not by the absence of a method.
   *
   * `granted` is read out of metadata rather than a column. Denials carry no
   * subject_id — the row was invisible, which is the whole point — so the
   * outcome lives with the rest of the attempt's detail.
   */
  async recent(limit: number): Promise<AuditEventSummary[]> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<{
        id: string;
        occurred_at: Date;
        actor_id: string | null;
        actor_role: string | null;
        action: string;
        subject_type: string;
        granted: boolean | null;
      }>(
        `SELECT id, occurred_at, actor_id, actor_role, action, subject_type,
                (metadata->>'granted')::boolean AS granted
         FROM audit_events
         ORDER BY occurred_at DESC
         LIMIT $1`,
        [limit],
      );

      return res.rows.map((r) => ({
        id: r.id,
        occurredAt: r.occurred_at,
        actorUserId: r.actor_id,
        actorRole: r.actor_role,
        action: r.action,
        resourceType: r.subject_type,
        // Events that carry no `granted` flag are actions that happened, so
        // they read as allowed. Only an explicit false is a denial.
        outcome: r.granted === false ? ('denied' as const) : ('allowed' as const),
      }));
    });
  }

  /**
   * Write one audit row.
   *
   * Takes an optional transaction so an audit write can be made part of the
   * same atomic unit as the action it records, where that is what we want. For
   * ACCESS events it deliberately is not: see `recordAccess`.
   */
  async record(record: AuditRecord, tx?: Tx): Promise<void> {
    const run = async (client: Tx): Promise<void> => {
      await client.query(
        `INSERT INTO audit_events
           (actor_id, actor_role, action, subject_type, subject_id,
            patient_id, ip_address, user_agent, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          record.actorId ?? null,
          record.actorRole ?? null,
          record.action,
          record.subjectType,
          record.subjectId ?? null,
          record.patientId ?? null,
          record.ipAddress ?? null,
          record.userAgent ?? null,
          JSON.stringify(scrub(record.metadata)),
        ],
      );
    };

    if (tx !== undefined) {
      await run(tx);
      return;
    }
    await this.db.tx(run);
  }

  /** Translate a domain event into an audit row. */
  async recordEvent(event: DomainEvent, tx?: Tx): Promise<void> {
    await this.record(
      {
        actorId: event.actorId,
        actorRole: event.actorRole,
        action: event.type,
        subjectType: subjectTypeFor(event),
        subjectId: subjectIdFor(event),
        patientId: patientIdFor(event),
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        metadata: metadataFor(event),
      },
      tx,
    );
  }
}

/**
 * Fields that must never reach the audit log.
 *
 * The audit log is read by support staff and exported for compliance review —
 * a wider audience than the clinical data itself. Metadata is a free-form
 * jsonb column, which makes it the most likely place for someone to
 * accidentally park a patient name or a token while debugging.
 */
const FORBIDDEN_METADATA_KEYS = new Set([
  'patientname',
  'patient_name',
  'fullname',
  'full_name',
  'dateofbirth',
  'date_of_birth',
  'dob',
  'nationalid',
  'national_id',
  'phone',
  'phonee164',
  'phone_e164',
  'token',
  'accesstoken',
  'access_token',
  'authorization',
  'password',
  'diagnosis',
  'findings',
  'pixeldata',
  'pixel_data',
]);

export function scrub(metadata: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase().replace(/[\s-]/g, ''))) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] =
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? scrub(value as Record<string, unknown>)
        : value;
  }
  return out;
}

function subjectTypeFor(event: DomainEvent): string {
  switch (event.type) {
    case 'PatientCreated':
      return 'patient';
    case 'ConsentGranted':
    case 'ConsentRevoked':
      return 'consent';
    case 'StudyUploadCompleted':
    case 'StudyAccessed':
      return 'study';
    case 'CaseSubmitted':
    case 'CaseQuoted':
    case 'CaseCancelled':
    case 'CaseDeclined':
    case 'CaseExpired':
    case 'CaseAccepted':
      return 'case';
  }
}

function subjectIdFor(event: DomainEvent): string | undefined {
  switch (event.type) {
    case 'PatientCreated':
      return event.patientId;
    case 'ConsentGranted':
    case 'ConsentRevoked':
      return event.consentId;
    case 'StudyUploadCompleted':
    case 'StudyAccessed':
      return event.studyId;
    case 'CaseSubmitted':
    case 'CaseQuoted':
    case 'CaseCancelled':
    case 'CaseDeclined':
    case 'CaseExpired':
    case 'CaseAccepted':
      return event.caseId;
  }
}

function patientIdFor(event: DomainEvent): string | undefined {
  if (!('patientId' in event)) return undefined;
  // Explicitly normalise empty-string to undefined: patient_id is a uuid
  // column, and '' is not a uuid. A denied access legitimately has no patient.
  const value = event.patientId;
  return value === undefined || value === '' ? undefined : value;
}

function metadataFor(event: DomainEvent): Record<string, unknown> {
  switch (event.type) {
    case 'StudyAccessed':
      return {
        accessKind: event.accessKind,
        granted: event.granted,
        // Carried in metadata rather than subject_id: on a refusal there is no
        // internal id to record, but WHAT was asked for is the useful part of
        // the signal.
        studyInstanceUid: event.studyInstanceUid,
      };
    case 'StudyUploadCompleted':
      return {
        fileCount: event.fileCount,
        totalBytes: event.totalBytes,
        containsLossy: event.containsLossy,
      };
    case 'ConsentGranted':
      return {
        grantedTo: event.grantedTo,
        termsVersion: event.termsVersion,
        termsLocale: event.termsLocale,
      };
    case 'ConsentRevoked':
      return { grantedTo: event.grantedTo };
    case 'CaseSubmitted':
      // No doctor yet: one is chosen at quote, because the doctor's tier is a
      // term in the price.
      return { organisationId: event.organisationId, specialty: event.specialty };
    case 'CaseQuoted':
      // The amount IS recorded here. What the lab was promised at the moment
      // they committed is the fact a later dispute turns on, and reading it
      // back off the row would only prove what the row says today.
      return {
        doctorId: event.doctorId,
        amountMinor: event.amountMinor,
        currency: event.currency,
      };
    case 'CaseCancelled':
      return {
        doctorId: event.doctorId,
        // A short coordination note. Never clinical — the event carries no
        // clinical field for a careless subscriber to reach for.
        ...(event.reason === undefined ? {} : { reason: event.reason }),
      };
    case 'CaseDeclined':
    case 'CaseExpired':
    case 'CaseAccepted':
      // No amount: none of these move money on their own, and a details blob
      // with a currency in it would imply otherwise to whoever reads the log.
      return { doctorId: event.doctorId };
    case 'PatientCreated':
      return { createdByDoctor: event.createdByDoctor };
  }
}
