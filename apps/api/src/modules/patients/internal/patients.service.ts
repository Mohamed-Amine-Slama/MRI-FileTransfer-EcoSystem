import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../shared/db/database.service';
import { requireContext } from '../../../shared/context/request-context';
import { EventBus } from '../../../shared/events/event-bus';
import {
  evaluatePhoneMatch,
  isValidE164,
  normalisePhoneForLookup,
  preserveEnteredName,
  type PatientCandidate,
} from './patient-matching';

/**
 * Patients module — BUILD_SPEC P5.1, P5.2, P3.3.
 *
 * Every query runs through DatabaseService.tx, so row-level security applies
 * to all of it. Nothing here re-implements an ownership check in TypeScript:
 * a doctor sees their own patients because the policy says so, not because a
 * `WHERE created_by_doctor = ?` was remembered. That is the point of ADR-6 —
 * forgetting the WHERE clause must not be enough to leak a record.
 */

export interface CreatePatientInput {
  phoneE164: string;
  fullName: string;
  dateOfBirth: string;
  sex: 'M' | 'F' | 'O';
  nationalId?: string;
  nationalIdType?: string;
  /**
   * Set only after the doctor has been shown the existing candidates and has
   * explicitly confirmed this is a different person (P3.3).
   */
  confirmedDistinctFrom?: string[];
}

export type CreatePatientResult =
  | { kind: 'created'; patientId: string }
  | { kind: 'confirmation_required'; candidates: PatientCandidate[] };

export class InvalidPhoneError extends Error {
  constructor(phone: string) {
    super(`Phone number must be in E.164 format (e.g. +218912345678); got "${phone}"`);
    this.name = 'InvalidPhoneError';
  }
}

@Injectable()
export class PatientsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly bus: EventBus,
  ) {}

  /**
   * Find existing patients by phone (P3.3).
   *
   * Phone only. Never name — transliteration across the Libya-Tunisia border
   * makes name matching unreliable in the direction that merges two people.
   */
  async findByPhone(phone: string): Promise<PatientCandidate[]> {
    const normalised = normalisePhoneForLookup(phone);
    if (!isValidE164(normalised)) throw new InvalidPhoneError(phone);

    return this.db.tx(async (tx) => {
      const res = await tx.query<{
        id: string;
        full_name: string;
        date_of_birth: string;
        phone_e164: string;
        sex: 'M' | 'F' | 'O';
      }>(
        `SELECT id, full_name, date_of_birth, phone_e164, sex
         FROM patients_patients
         WHERE phone_e164 = $1
         ORDER BY created_at`,
        [normalised],
      );

      return res.rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        dateOfBirth: r.date_of_birth,
        phoneE164: r.phone_e164,
        sex: r.sex,
      }));
    });
  }

  /**
   * Create a patient record (DECISION D1: doctor-created).
   *
   * On a phone match this returns `confirmation_required` rather than creating
   * or reusing. The caller must show the doctor the candidates and re-submit
   * with `confirmedDistinctFrom` naming them. There is deliberately no
   * "merge" outcome: merging two people is the worst failure this system can
   * produce, and it is not reversible by the person who caused it (§17).
   */
  async create(input: CreatePatientInput): Promise<CreatePatientResult> {
    const ctx = requireContext();
    const phone = normalisePhoneForLookup(input.phoneE164);
    if (!isValidE164(phone)) throw new InvalidPhoneError(input.phoneE164);

    const existing = await this.findByPhone(phone);
    const match = evaluatePhoneMatch(existing);

    if (match.kind === 'confirmation_required') {
      const confirmed = new Set(input.confirmedDistinctFrom ?? []);
      const unconfirmed = match.candidates.filter((c) => !confirmed.has(c.id));
      if (unconfirmed.length > 0) {
        return { kind: 'confirmation_required', candidates: unconfirmed };
      }
      // Every candidate was explicitly acknowledged as a different person.
      // Proceed to create a SECOND record — duplicates are recoverable,
      // merges are not.
    }

    const patientId = await this.db.tx(async (tx) => {
      const res = await tx.query<{ id: string }>(
        `INSERT INTO patients_patients
           (phone_e164, full_name, date_of_birth, sex, national_id, national_id_type,
            created_by_doctor)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          phone,
          // Stored exactly as the doctor typed it (P3.3 rule 4).
          preserveEnteredName(input.fullName),
          input.dateOfBirth,
          input.sex,
          input.nationalId ?? null,
          input.nationalIdType ?? null,
          ctx.userId,
        ],
      );
      const row = res.rows[0];
      if (row === undefined) throw new NotFoundException('Patient not found');
      return row.id;
    });

    await this.bus.publish({
      type: 'PatientCreated',
      patientId,
      createdByDoctor: ctx.userId,
      actorId: ctx.userId,
      actorRole: ctx.role,
      occurredAt: new Date(),
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { kind: 'created', patientId };
  }

  /** List the caller's own patients. Scope comes entirely from RLS. */
  async list(): Promise<PatientCandidate[]> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<{
        id: string;
        full_name: string;
        date_of_birth: string;
        phone_e164: string;
        sex: 'M' | 'F' | 'O';
      }>(
        `SELECT id, full_name, date_of_birth, phone_e164, sex
         FROM patients_patients
         ORDER BY created_at DESC`,
      );
      return res.rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        dateOfBirth: r.date_of_birth,
        phoneE164: r.phone_e164,
        sex: r.sex,
      }));
    });
  }

  /**
   * Fetch one patient.
   *
   * Returns 404 — not 403 — when the caller may not see it (§6). A 403
   * confirms the record exists, which is itself a disclosure: it tells an
   * attacker enumerating ids which ones are real.
   */
  async getById(patientId: string): Promise<PatientCandidate> {
    const found = await this.db.tx(async (tx) => {
      const res = await tx.query<{
        id: string;
        full_name: string;
        date_of_birth: string;
        phone_e164: string;
        sex: 'M' | 'F' | 'O';
      }>(
        `SELECT id, full_name, date_of_birth, phone_e164, sex
         FROM patients_patients WHERE id = $1`,
        [patientId],
      );
      return res.rows[0];
    });

    if (found === undefined) throw new NotFoundException('Patient not found');
    return {
      id: found.id,
      fullName: found.full_name,
      dateOfBirth: found.date_of_birth,
      phoneE164: found.phone_e164,
      sex: found.sex,
    };
  }

}
