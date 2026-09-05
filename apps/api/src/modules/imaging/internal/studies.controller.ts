import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import { StudyAccessService, type StudySummary } from './study-access.service';

/**
 * Study worklist — BUILD_SPEC P8.
 *
 * Separate from DicomWebController on purpose. That controller serves pixels
 * and metadata and audits every request; this one lists headers for a
 * worklist. Keeping them apart is what keeps `StudyAccessed` meaning "someone
 * opened a scan" rather than "someone loaded a page".
 */

// Exactly one filter, and one is required. An unfiltered "all studies" query
// would rely entirely on RLS to bound the result — correct, but it would still
// hand a Libyan doctor every study they have ever uploaded in one response,
// which is a report, not a worklist.
const querySchema = z
  .object({
    patientId: z.string().uuid().optional(),
    appointmentId: z.string().uuid().optional(),
  })
  .refine(
    (q) => (q.patientId === undefined) !== (q.appointmentId === undefined),
    'Provide exactly one of patientId or appointmentId',
  );

@Controller('studies')
export class StudiesController {
  constructor(private readonly studies: StudyAccessService) {}

  @RequiresRole('libya_doctor', 'tunisia_doctor')
  @Get()
  async list(@Query() query: unknown): Promise<{ studies: StudySummary[] }> {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException('Provide exactly one of patientId or appointmentId');
    }
    return { studies: await this.studies.listStudies(parsed.data) };
  }
}
