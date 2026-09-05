import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import {
  endpointSideSchema,
  inviteMemberSchema,
  providerKindSchema,
} from '@mir/contracts';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import {
  type ClinicianRow, OrganisationsService, type MemberRow, type OrganisationRow } from './organisations.service';

/**
 * Organisations — brief §3, §5.1, §5.5, §5.8.
 *
 * NOTE WHICH ROLES CAN REACH WHAT. Creating an organisation is `applicant` and
 * nothing else: an approved clinician starting a second practice is a real case
 * that needs its own ops decision, not a side door through this route. The ops
 * queue is `admin` only. Everything in between is any seated member, with
 * row-level security deciding which organisation that is.
 */

const createSchema = z.object({
  kind: providerKindSchema,
  legalName: z.string().min(1).max(300),
  corridorId: z.string().min(1).max(64),
  side: endpointSideSchema,
  // Shape comes from the corridor's documentRequirements, which this layer has
  // no opinion about — it is validated against the corridor by the screen that
  // renders it and stored as-is (§4.3).
  credentials: z.record(z.string(), z.unknown()).default({}),
  seatCount: z.number().int().min(1).max(500),
});

const decisionSchema = z.object({
  approve: z.boolean(),
  /**
   * A dictionary key, never free text. An ops reviewer's English sentence is
   * unreadable to an Arabic-speaking applicant (§4.2), and the applicant is
   * precisely who has to act on it.
   */
  reasonKey: z.string().regex(/^[a-z][A-Za-z0-9]*$/).max(64).optional(),
});

const acceptSchema = z.object({ token: z.string().min(16).max(256) });

@Controller()
export class OrganisationsController {
  constructor(private readonly organisations: OrganisationsService) {}

  @RequiresRole('applicant')
  @Post('organisations')
  async create(@Body() body: unknown): Promise<OrganisationRow> {
    return this.organisations.create(createSchema.parse(body));
  }

  /**
   * Returns null rather than 404 when the caller belongs to no organisation.
   * "You have not applied yet" is a normal state for an applicant, not an
   * error, and the sign-up flow branches on it.
   */
  // `assistant` included: the booking screen resolves the organisation here
  // before asking for its clinicians, so without it an assistant cannot see
  // which doctors they may book for.
  @RequiresRole('applicant', 'libya_doctor', 'tunisia_doctor', 'assistant')
  @Get('organisations/mine')
  async mine(): Promise<{ organisation: OrganisationRow | null }> {
    return { organisation: await this.organisations.mine() };
  }

  @RequiresRole('applicant', 'libya_doctor', 'tunisia_doctor', 'assistant')
  @Get('organisations/:id/members')
  async members(@Param('id', ParseUUIDPipe) id: string): Promise<{ members: MemberRow[] }> {
    return { members: await this.organisations.members(id) };
  }

  /**
   * The organisation's clinicians and their specialties, for assigning work.
   *
   * Distinct from `members`, which lists seats. This lists the people an
   * appointment can be given TO, and carries the specialty the booking screen
   * filters on. An assistant may read it: routing an appointment to the right
   * doctor is exactly a receptionist's job.
   */
  @RequiresRole('libya_doctor', 'tunisia_doctor', 'assistant')
  @Get('organisations/:id/clinicians')
  async clinicians(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ clinicians: ClinicianRow[] }> {
    return { clinicians: await this.organisations.clinicians(id) };
  }

  @RequiresRole('libya_doctor', 'tunisia_doctor')
  @Post('organisations/:id/invitations')
  @HttpCode(204)
  async invite(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<void> {
    const input = inviteMemberSchema.parse(body);
    await this.organisations.invite(id, input.email, input.seatRole, {
      ...(input.specialty === undefined ? {} : { specialty: input.specialty }),
      ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
    });
  }

  /**
   * Accepting is open to every signed-in role, because the invitee's role is
   * exactly what has not been decided yet — they are an applicant until the
   * organisation they are joining is approved.
   *
   * A bad, expired, or already-used token is a 404 rather than a 400: the three
   * must be indistinguishable, or the endpoint confirms which tokens are real.
   */
  @RequiresRole('applicant', 'libya_doctor', 'tunisia_doctor', 'patient', 'admin', 'assistant')
  @Post('invitations/accept')
  async accept(@Body() body: unknown): Promise<OrganisationRow> {
    const input = acceptSchema.parse(body);
    const organisation = await this.organisations.acceptInvitation(input.token);
    if (organisation === null) throw new NotFoundException('invitation_not_found');
    return organisation;
  }

  // --- ops (§5.8) ----------------------------------------------------------

  @RequiresRole('admin')
  @Get('admin/organisations')
  async queue(): Promise<{ organisations: OrganisationRow[] }> {
    return { organisations: await this.organisations.all() };
  }

  @RequiresRole('admin')
  @Post('admin/organisations/:id/decision')
  @HttpCode(204)
  async decide(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<void> {
    const input = decisionSchema.parse(body);
    await this.organisations.decide(id, input.approve, input.reasonKey);
  }
}
