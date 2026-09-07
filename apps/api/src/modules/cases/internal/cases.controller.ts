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
import { CasesService, type CaseSummary } from './cases.service';
import { DirectoryService, type DirectoryEntry } from './directory.service';

/**
 * Case HTTP layer — consult-model spec Part 1.
 *
 * Every route declares its roles explicitly; P1.5 refuses to boot otherwise.
 *
 * Note what is NOT here: any ownership check, and no price arithmetic. Which
 * cases come back is row-level security's decision; what one costs is the
 * pricing module's. This layer parses input and shapes output.
 *
 * Dates cross the wire as ISO-8601 strings and are parsed to instants here. A
 * wall-clock string with no offset would be ambiguous between Tripoli and
 * Tunis, and the answer window is counted in hours from an instant.
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

const quoteSchema = z.object({ doctorId: z.string().uuid() });

const acceptingSchema = z.object({ accepting: z.boolean() });

const directoryQuerySchema = z.object({ specialty: z.string().min(1).max(64).optional() });

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
 * Who touches a case: the two corridor endpoints and a seated assistant.
 *
 * Spelled out rather than derived, because the API has no corridor registry —
 * that lives in the web app (§4.3). The `@RequiresRole` list is the coarse
 * gate; which ROWS each of them reaches is row-level security's decision, and
 * these three reach very different ones.
 */
const CASE_ROLES = ['libya_doctor', 'tunisia_doctor', 'assistant'] as const;

@Controller()
export class CasesController {
  constructor(
    private readonly cases: CasesService,
    private readonly directory: DirectoryService,
  ) {}

  // --- the directory and the switch ----------------------------------------

  /**
   * Doctors accepting work right now, with an indicative price each.
   *
   * No corridor parameter: it is read from the caller's own organisation, so a
   * lab cannot browse a corridor it is not party to.
   */
  @RequiresRole('libya_doctor')
  @Get('directory')
  async listDirectory(@Query() query: unknown): Promise<{ doctors: DirectoryEntry[] }> {
    const { specialty } = directoryQuerySchema.parse(query ?? {});
    return { doctors: await this.directory.listAcceptingDoctors(specialty) };
  }

  /**
   * The receiving doctor opens or closes their own door.
   *
   * There is no id in the path. The row is chosen from the session, so the
   * route offers nobody a way to switch a colleague off.
   */
  @RequiresRole('tunisia_doctor')
  @RateLimit('scheduleWrite')
  @Post('doctors/me/accepting')
  @HttpCode(200)
  async setAccepting(@Body() body: unknown): Promise<{ accepting: boolean }> {
    const { accepting } = acceptingSchema.parse(body);
    await this.directory.setAccepting(accepting);
    return { accepting };
  }

  // --- cases ---------------------------------------------------------------

  @RequiresRole('libya_doctor', 'tunisia_doctor', 'assistant')
  @Get('cases')
  async list(@Query() query: unknown): Promise<{ cases: CaseDto[] }> {
    const range = rangeQuerySchema.parse(query ?? {});
    const rows = await this.cases.listCases(range);
    return { cases: rows.map(toDto) };
  }

  @RequiresRole('libya_doctor', 'tunisia_doctor', 'assistant')
  @Get('cases/:id')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<CaseDto> {
    return toDto(await this.cases.getCase(id));
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
    const item = await this.cases.submit({
      patientId: input.patientId,
      specialty: input.specialty,
      studyIds: input.studyIds,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    });
    // Read the row back rather than returning blank names: the old response
    // sent patientName: '' and doctorName: '', which the case list then had to
    // refetch to correct.
    return toDto(await this.cases.getCase(item.id));
  }

  /**
   * Pick a doctor and lock a price.
   *
   * The price is not in the request and never could be. The lab sends who they
   * chose; what that costs is the platform's answer, computed from the rate
   * card, the doctor's tier and how many of their colleagues are on.
   */
  @RequiresRole('libya_doctor')
  @RateLimit('scheduleWrite')
  @Post('cases/:id/quote')
  @HttpCode(200)
  async quote(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<CaseDto> {
    const { doctorId } = quoteSchema.parse(body);
    return toDto(await this.cases.quote(id, doctorId));
  }

  /**
   * The quote is settled and the case may be worked.
   *
   * TODO(sub-project 4): this is the seam the escrow hold plugs into. Today it
   * marks the case paid and accrues the referring side's fee; it moves no
   * money, because there is no rail (BLOCKING ITEM L7). Once there is one, the
   * webhook owns this transition and the route goes — a lab must not be able
   * to mark its own case paid.
   */
  @RequiresRole('libya_doctor')
  @RateLimit('scheduleWrite')
  @Post('cases/:id/pay')
  @HttpCode(200)
  async pay(@Param('id', ParseUUIDPipe) id: string): Promise<CaseDto> {
    await this.cases.markPaid(id);
    return toDto(await this.cases.getCase(id));
  }

  @RequiresRole('libya_doctor')
  @Delete('cases/:id')
  @HttpCode(204)
  async cancel(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.cases.cancel(id);
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
  async accept(@Param('id', ParseUUIDPipe) id: string): Promise<{ status: 'accepted' }> {
    await this.cases.accept(id);
    return { status: 'accepted' };
  }

  /** The receiving doctor refuses the referral. */
  @RequiresRole('tunisia_doctor')
  @Post('cases/:id/decline')
  @HttpCode(200)
  async decline(@Param('id', ParseUUIDPipe) id: string): Promise<{ status: 'declined' }> {
    await this.cases.decline(id);
    return { status: 'declined' };
  }

  // --- the case in flight --------------------------------------------------

  /** Case detail the referring side may correct — the reason and the notes. */
  @RequiresRole(...CASE_ROLES)
  @RateLimit('scheduleWrite')
  @Patch('cases/:id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<CaseDto> {
    const patch = updateCaseSchema.parse(body);
    return toDto(await this.cases.updateCase(id, patch));
  }

  /**
   * The doctor's answer exists.
   *
   * Only the receiving doctor. It admitted the whole case-role list back when
   * it marked a visit complete and a receptionist could reasonably do that; an
   * answer is authored by the clinician who read the imaging, and this is the
   * transition that will release their payment.
   */
  @RequiresRole('tunisia_doctor')
  @Post('cases/:id/answer')
  @HttpCode(200)
  async answer(@Param('id', ParseUUIDPipe) id: string): Promise<{ status: 'answered' }> {
    await this.cases.markAnswered(id);
    return { status: 'answered' };
  }

  /**
   * The receiving side withdraws, with a reason.
   *
   * Deliberately not the same route as DELETE /cases/:id, which is the LAB
   * withdrawing its own case. A lab told only "cancelled" cannot tell a clinic
   * closure from its own request having lapsed, and the reason is what makes
   * the difference legible.
   */
  @RequiresRole(...CASE_ROLES)
  @RateLimit('scheduleWrite')
  @Post('cases/:id/cancel')
  @HttpCode(200)
  async cancelAsDoctor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ status: 'cancelled' }> {
    const input = cancelSchema.parse(body ?? {});
    await this.cases.cancelAsDoctor(id, input.reason);
    return { status: 'cancelled' };
  }

}
