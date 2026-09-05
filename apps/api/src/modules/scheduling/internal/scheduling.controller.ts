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
  type AppointmentSummary,
  type AvailabilityRule,
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

const bookSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  startsAt: isoDate,
  endsAt: isoDate,
  studyIds: z.array(z.string().uuid()).max(50).optional(),
  kind: z.enum(['consultation', 'follow_up', 'imaging', 'other']).optional(),
  reason: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(500).optional(),
});

const availabilitySchema = z.object({
  startsAt: isoDate,
  endsAt: isoDate,
  // A slot shorter than five minutes is a data-entry slip, not a booking
  // policy, and it would generate thousands of slots for one window.
  slotMinutes: z.number().int().min(5).max(240).optional(),
  /** An assistant writes to a doctor's calendar; RLS decides whether they may. */
  doctorId: z.string().uuid().optional(),
});

const slotQuerySchema = z.object({ from: isoDate, to: isoDate });

const rangeQuerySchema = z.object({ from: isoDate.optional(), to: isoDate.optional() });

const appointmentKind = z.enum(['consultation', 'follow_up', 'imaging', 'other']);

/**
 * Free text that reaches the patient and the audit log, so it is bounded.
 * Nothing here is clinical: §1.3 keeps this a scheduling service, and an
 * unbounded note box with no stated purpose is how that line gets crossed.
 */
const shortNote = z.string().trim().max(500);

const rescheduleSchema = z.object({ startsAt: isoDate, endsAt: isoDate });

const updateAppointmentSchema = z
  .object({
    kind: appointmentKind.optional(),
    reason: shortNote.nullable().optional(),
    notes: shortNote.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

const cancelSchema = z.object({ reason: shortNote.optional() });

/** ISO-8601 weekday and 24-hour wall-clock times, as the rules table stores. */
const ruleSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  // An IANA zone: "every Tuesday at 09:00" is meaningless without one.
  timezone: z.string().min(1).max(64),
  slotMinutes: z.number().int().min(5).max(240).optional(),
  validFrom: isoDate.optional(),
  validUntil: isoDate.optional(),
  doctorId: z.string().uuid().optional(),
});

interface AppointmentDto {
  id: string;
  patientId: string;
  patientName: string;
  /** Present only for an assistant, whose job is to ring the patient. */
  patientPhone?: string;
  doctorId: string;
  doctorName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  kind: string;
  reason: string | null;
  notes: string | null;
  studyIds: string[];
}

function toDto(a: AppointmentSummary): AppointmentDto {
  return {
    id: a.id,
    patientId: a.patientId,
    patientName: a.patientName,
    ...(a.patientPhone === undefined ? {} : { patientPhone: a.patientPhone }),
    doctorId: a.doctorId,
    doctorName: a.doctorName,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    status: a.status,
    kind: a.kind,
    reason: a.reason,
    notes: a.notes,
    studyIds: a.studyIds ?? [],
  };
}

interface AvailabilityRuleDto {
  id: string;
  doctorId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  timezone: string;
  slotMinutes: number;
  validFrom: string;
  validUntil: string | null;
}

function toRuleDto(r: AvailabilityRule): AvailabilityRuleDto {
  return {
    id: r.id,
    doctorId: r.doctorId,
    weekday: r.weekday,
    startTime: r.startTime,
    endTime: r.endTime,
    timezone: r.timezone,
    slotMinutes: r.slotMinutes,
    validFrom: r.validFrom.toISOString().slice(0, 10),
    validUntil: r.validUntil === null ? null : r.validUntil.toISOString().slice(0, 10),
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

  @RequiresRole('libya_doctor')
  @Get('doctors/:id/slots')
  async openSlots(
    @Param('id', ParseUUIDPipe) doctorId: string,
    @Query() query: unknown,
  ): Promise<{ slots: { startsAt: string; endsAt: string }[] }> {
    const { from, to } = slotQuerySchema.parse(query);
    const slots = await this.scheduling.listOpenSlots(doctorId, from, to);
    return {
      slots: slots.map((s) => ({
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
      })),
    };
  }

  @RequiresRole(...CALENDAR_ROLES)
  @Get('availability')
  async listAvailability(@Query('doctorId') doctorId?: string): Promise<{
    windows: { id: string; doctorId: string; startsAt: string; endsAt: string; slotMinutes: number }[];
  }> {
    const windows = await this.scheduling.listAvailability(
      doctorId === undefined ? undefined : z.string().uuid().parse(doctorId),
    );
    return {
      windows: windows.map((w) => ({
        id: w.id,
        doctorId: w.doctorId,
        startsAt: w.startsAt.toISOString(),
        endsAt: w.endsAt.toISOString(),
        slotMinutes: w.slotMinutes,
      })),
    };
  }

  @RequiresRole(...CALENDAR_ROLES)
  @RateLimit('scheduleWrite')
  @Post('availability')
  @HttpCode(201)
  async addAvailability(@Body() body: unknown): Promise<{ id: string }> {
    const input = availabilitySchema.parse(body);
    const window = await this.scheduling.addAvailability(input);
    return { id: window.id };
  }

  // --- appointments --------------------------------------------------------

  @RequiresRole('libya_doctor', 'tunisia_doctor', 'assistant')
  @Get('appointments')
  async list(@Query() query: unknown): Promise<{ appointments: AppointmentDto[] }> {
    const range = rangeQuerySchema.parse(query ?? {});
    const rows = await this.scheduling.listAppointments(range);
    return { appointments: rows.map(toDto) };
  }

  @RequiresRole('libya_doctor', 'tunisia_doctor', 'assistant')
  @Get('appointments/:id')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<AppointmentDto> {
    return toDto(await this.scheduling.getAppointment(id));
  }

  /**
   * Book a slot.
   *
   * A losing booker gets 409 from SlotUnavailableError, which the global
   * exception filter renders without any driver detail (§6). That is P10.2's
   * gate: a clean conflict, never a 500.
   */
  @RequiresRole('libya_doctor', 'tunisia_doctor', 'assistant')
  @RateLimit('scheduleWrite')
  @Post('appointments')
  @HttpCode(201)
  async book(@Body() body: unknown): Promise<AppointmentDto> {
    const input = bookSchema.parse(body);
    const appointment = await this.scheduling.book({
      patientId: input.patientId,
      doctorId: input.doctorId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      studyIds: input.studyIds,
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    });

    // Read the row back rather than returning blank names. The old response
    // sent patientName: '' and doctorName: '', which was survivable when the
    // caller navigated away to a list that refetched — and is not, now that a
    // calendar renders the appointment where it stands.
    return toDto(await this.scheduling.getAppointment(appointment.id));
  }

  @RequiresRole('libya_doctor')
  @Delete('appointments/:id')
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
  @Post('appointments/:id/accept')
  @HttpCode(200)
  async accept(@Param('id', ParseUUIDPipe) id: string): Promise<{ status: 'confirmed' }> {
    await this.scheduling.accept(id);
    return { status: 'confirmed' };
  }

  /** The receiving doctor refuses the referral. */
  @RequiresRole('tunisia_doctor')
  @Post('appointments/:id/decline')
  @HttpCode(200)
  async decline(@Param('id', ParseUUIDPipe) id: string): Promise<{ status: 'declined' }> {
    await this.scheduling.decline(id);
    return { status: 'declined' };
  }

  // --- running the diary ---------------------------------------------------

  /**
   * Move an appointment.
   *
   * Rate limited for the same reason booking is: this writes the exclusion
   * constraint under contention, and a script retrying it is indistinguishable
   * from a busy morning until it is bounded.
   */
  @RequiresRole(...CALENDAR_ROLES)
  @RateLimit('scheduleWrite')
  @Patch('appointments/:id/time')
  async reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<AppointmentDto> {
    const input = rescheduleSchema.parse(body);
    return toDto(await this.scheduling.reschedule(id, input.startsAt, input.endsAt));
  }

  /** Scheduling detail — reason, kind, notes. Never a time change; that is above. */
  @RequiresRole(...CALENDAR_ROLES)
  @RateLimit('scheduleWrite')
  @Patch('appointments/:id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<AppointmentDto> {
    const patch = updateAppointmentSchema.parse(body);
    return toDto(await this.scheduling.updateAppointment(id, patch));
  }

  @RequiresRole(...CALENDAR_ROLES)
  @Post('appointments/:id/complete')
  @HttpCode(200)
  async complete(@Param('id', ParseUUIDPipe) id: string): Promise<{ status: 'completed' }> {
    await this.scheduling.markCompleted(id);
    return { status: 'completed' };
  }

  @RequiresRole(...CALENDAR_ROLES)
  @Post('appointments/:id/no-show')
  @HttpCode(200)
  async noShow(@Param('id', ParseUUIDPipe) id: string): Promise<{ status: 'no_show' }> {
    await this.scheduling.markNoShow(id);
    return { status: 'no_show' };
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
  @Post('appointments/:id/cancel')
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

  /** Take a window down. An UPDATE, not an erasure — see the service. */
  @RequiresRole(...CALENDAR_ROLES)
  @Delete('availability/:id')
  @HttpCode(204)
  async withdrawAvailability(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.scheduling.withdrawAvailability(id);
  }

  @RequiresRole(...CALENDAR_ROLES)
  @Get('availability/rules')
  async listRules(
    @Query('doctorId') doctorId?: string,
  ): Promise<{ rules: AvailabilityRuleDto[] }> {
    const rules = await this.scheduling.listAvailabilityRules(
      doctorId === undefined ? undefined : z.string().uuid().parse(doctorId),
    );
    return { rules: rules.map(toRuleDto) };
  }

  @RequiresRole(...CALENDAR_ROLES)
  @RateLimit('scheduleWrite')
  @Post('availability/rules')
  @HttpCode(201)
  async addRule(@Body() body: unknown): Promise<{ id: string; generated: number }> {
    const input = ruleSchema.parse(body);
    return this.scheduling.addAvailabilityRule(input);
  }

  @RequiresRole(...CALENDAR_ROLES)
  @Delete('availability/rules/:id')
  @HttpCode(204)
  async withdrawRule(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.scheduling.withdrawAvailabilityRule(id);
  }
}
