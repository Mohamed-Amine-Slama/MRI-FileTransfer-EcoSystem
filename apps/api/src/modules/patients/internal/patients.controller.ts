import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import { PatientsService, type CreatePatientResult } from './patients.service';
import type { PatientCandidate } from './patient-matching';

/**
 * Patients HTTP layer — BUILD_SPEC P5.1.
 *
 * Every route declares its access explicitly (P1.5); the app refuses to boot
 * otherwise. Note what these handlers do NOT contain: any ownership filtering.
 * A Libyan doctor sees only their own patients because of row-level security,
 * and the end-to-end tests prove that through this layer rather than trusting
 * the SQL-level tests to carry over.
 */

const createPatientSchema = z.object({
  phoneE164: z.string().min(1),
  fullName: z.string().min(1).max(200),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must be YYYY-MM-DD'),
  sex: z.enum(['M', 'F', 'O']),
  nationalId: z.string().max(64).optional(),
  nationalIdType: z.string().max(32).optional(),
  confirmedDistinctFrom: z.array(z.string().uuid()).optional(),
});

@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  /** Search by phone. Phone only — never by name (P3.3). */
  // Both sides work cases, and both need to find the patient by phone
  // first. Phone-only, and RLS still returns only the caller's own records.
  @RequiresRole('libya_doctor', 'tunisia_doctor')
  @Get('search')
  async search(@Query('phone') phone: string): Promise<{ candidates: PatientCandidate[] }> {
    const candidates = await this.patients.findByPhone(phone ?? '');
    return { candidates };
  }

  @RequiresRole('libya_doctor', 'tunisia_doctor')
  @Get()
  async list(): Promise<{ patients: PatientCandidate[] }> {
    return { patients: await this.patients.list() };
  }

  /**
   * Create a patient.
   *
   * Returns 200 with `confirmation_required` when the phone already exists —
   * not an error, because the doctor has a decision to make. Creating on a
   * phone match without asking would be the silent merge P3.3 forbids.
   */
  /**
   * `tunisia_doctor` is here as of the practice calendar. D1 gives the
   * REFERRING doctor the creation of a referral's patient, and that is still
   * how a referral works — but a receiving clinic also has walk-ins of its own,
   * who are not part of any referral and have to be written down somewhere.
   *
   * It widens nothing: `patients_creator_insert` still requires
   * `created_by_doctor = app_current_user_id()`, so either side reaches exactly
   * the records it created and no others.
   */
  @RequiresRole('libya_doctor', 'tunisia_doctor')
  @Post()
  @HttpCode(200)
  async create(@Body() body: unknown): Promise<CreatePatientResult> {
    const input = createPatientSchema.parse(body);
    return this.patients.create(input);
  }

  @RequiresRole('libya_doctor', 'tunisia_doctor')
  @Get(':id')
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<PatientCandidate> {
    // 404 for records the caller cannot see, never 403 (§6).
    return this.patients.getById(id);
  }
}
