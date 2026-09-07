import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import { RateLimit } from '../../../shared/ratelimit/rate-limit.guard';
import {
  SchedulingService,
  type CaseSummary,
  type DoctorSummary,
} from './scheduling.service';

/**
 * Scheduling HTTP layer — BUILD_SPEC P10.
 *
 * Every route declares its roles explicitly; P1.5 refuses to boot otherwise.
 *
 * Note what is NOT here: any ownership check. Which appointments come back is
 * decided by row-level security, and the booking race is decided by the
 * exclusion constraint. This layer parses input and shapes output.
 *
 * Dates cross the wire as ISO-8601 strings and are parsed to instants here.
 * A wall-clock string with no offset would be ambiguous between Tripoli and
 * Tunis, which is exactly the class of bug P10.1 exists to rule out.
 */

const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));

const rangeQuerySchema = z.object({ from: isoDate.optional(), to: isoDate.optional() });

/**
 * Free text that reaches the other side and the audit log, so it is bounded.
 * Nothing here is a clinical finding: an unbounded note box with no stated
 * purpose is how a coordination field turns into a medical record.
 */
const shortNote = z.string().trim().max(500);

const submitSchema = z.object({
  patientId: z.string().uuid(),
  specialty: z.string().min(1).max(64),
  studyIds: z.array(z.string().uuid()).optional(),
  reason: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

const updateCaseSchema = z
  .object({
    reason: shortNote.nullable().optional(),
    notes: shortNote.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

const cancelSchema = z.object({ reason: shortNote.optional() });

/** ISO-8601 weekday and 24-hour wall-clock times, as the rules table stores. */
interface CaseDto {
  id: string;
  patientId: string;
  patientName: string | null;
  /** Present only for an assistant, whose job is to ring the patient. */
  patientPhone?: string;
  doctorId: string | null;
  doctorName: string | null;
  organisationId: string;
  specialty: string;
  status: string;
  reason: string | null;
  notes: string | null;
  quotedAmountMinor: number | null;
  quotedCurrency: string | null;
  quoteExpiresAt: string | null;
  acceptedAt: string | null;
  answeredAt: string | null;
  answerDueAt: string | null;
  studyIds: string[];
}

function toDto(a: CaseSummary): CaseDto {
  return {
    id: a.id,
    patientId: a.patientId,
    patientName: a.patientName,
    ...(a.patientPhone === undefined ? {} : { patientPhone: a.patientPhone }),
    doctorId: a.doctorId,
    doctorName: a.doctorName,
    organisationId: a.organisationId,
    specialty: a.specialty,
    status: a.status,
    reason: a.reason,
    notes: a.notes,
    quotedAmountMinor: a.quotedAmountMinor,
    quotedCurrency: a.quotedCurrency,
    quoteExpiresAt: a.quoteExpiresAt?.toISOString() ?? null,
    acceptedAt: a.acceptedAt?.toISOString() ?? null,
    answeredAt: a.answeredAt?.toISOString() ?? null,
    answerDueAt: a.answerDueAt?.toISOString() ?? null,
    studyIds: a.studyIds ?? [],
  };
}

/**
 * Who runs a calendar: the two corridor endpoints and a seated assistant.
 *
 * Spelled out rather than derived, because the API has no corridor registry —
 * that lives in the web app (§4.3). The `@RequiresRole` list is the coarse gate;
 * which ROWS each of them reaches is row-level security's decision, and these
 * three reach very different ones.
 */
const CALENDAR_ROLES = ['libya_doctor', 'tunisia_doctor', 'assistant'] as const;

@Controller()
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  // --- doctors and availability -------------------------------------------

  /** Verified Tunisian doctors a patient may be referred to. */
  @RequiresRole('libya_doctor')
  @Get('doctors')
  async listDoctors(): Promise<{ doctors: DoctorSummary[] }> {
    return { doctors: await this.scheduling.listDoctors() };
  }

  // --- cases ---------------------------------------------------------------

  @RequiresRole('libya_doctor', 'tunisia_doctor', 'assistant')
  @Get('cases')
  async list(@Query() query: unknown): Promise<{ cases: CaseDto[] }> {
    const range = rangeQuerySchema.parse(query ?? {});
    const rows = await this.scheduling.listCases(range);
    return { cases: rows.map(toDto) };
  }

  @RequiresRole('libya_doctor', 'tunisia_doctor', 'assistant')
  @Get('cases/:id')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<CaseDto> {
    return toDto(await this.scheduling.getCase(id));
  }

  /**
   * Submit a case. Only the referring side may: a case is a lab asking for an
   * opinion, and a doctor creating one would be a doctor referring to himself.
   */
  @RequiresRole('libya_doctor')
  @RateLimit('scheduleWrite')
  @Post('cases')
  @HttpCode(201)
  async submit(@Body() body: unknown): Promise<CaseDto> {
    const input = submitSchema.parse(body);
    const item = await this.scheduling.submit({
      patientId: input.patientId,
      specialty: input.specialty,
      studyIds: input.studyIds,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    });
    // Read the row back rather than returning blank names: the old response
    // sent patientName: '' and doctorName: '', which the case list then had to
    // refetch to correct.
    return toDto(await this.scheduling.getCase(item.id));
  }

  @RequiresRole('libya_doctor')
  @Delete('cases/:id')
  @HttpCode(204)
  async cancel(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.scheduling.cancel(id);
  }

  /**
   * The receiving doctor accepts the referral.
   *
   * Paired with decline again. It was separated because accepting captured the
   * patient's card and therefore lived in the billing module; migration 0021
   * removed patient accounts and the card with them, so the two halves of one
   * decision are back in one place.
   */
  @RequiresRole('tunisia_doctor')
  @Post('cases/:id/accept')
  @HttpCode(200)
  async accept(@Param('id', ParseUUIDPipe) id: string): Promise<{ status: 'confirmed' }> {
    await this.scheduling.accept(id);
    return { status: 'confirmed' };
  }

  /** The receiving doctor refuses the referral. */
  @RequiresRole('tunisia_doctor')
  @Post('cases/:id/decline')
  @HttpCode(200)
  async decline(@Param('id', ParseUUIDPipe) id: string): Promise<{ status: 'declined' }> {
    await this.scheduling.decline(id);
    return { status: 'declined' };
  }

  // --- running the diary ---------------------------------------------------


  /** Scheduling detail — reason, kind, notes. Never a time change; that is above. */
  @RequiresRole(...CALENDAR_ROLES)
  @RateLimit('scheduleWrite')
  @Patch('cases/:id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<CaseDto> {
    const patch = updateCaseSchema.parse(body);
    return toDto(await this.scheduling.updateCase(id, patch));
  }

  @RequiresRole(...CALENDAR_ROLES)
  @Post('cases/:id/complete')
  @HttpCode(200)
  async complete(@Param('id', ParseUUIDPipe) id: string): Promise<{ status: 'completed' }> {
    await this.scheduling.markCompleted(id);
    return { status: 'completed' };
  }

  /**
   * The practice cancels, with a reason.
   *
   * Deliberately not the same route as DELETE /appointments/:id, which is the
   * PATIENT withdrawing. A patient told only "cancelled" cannot tell a clinic
   * closure from their own booking having lapsed, and the reason is what makes
   * the difference legible.
   */
  @RequiresRole(...CALENDAR_ROLES)
  @RateLimit('scheduleWrite')
  @Post('cases/:id/cancel')
  @HttpCode(200)
  async cancelAsDoctor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ status: 'cancelled' }> {
    const input = cancelSchema.parse(body ?? {});
    await this.scheduling.cancelAsDoctor(id, input.reason);
    return { status: 'cancelled' };
  }

  // --- availability upkeep -------------------------------------------------

}
