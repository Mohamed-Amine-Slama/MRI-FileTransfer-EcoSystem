import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import type { LedgerEntry } from '@mir/contracts';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import { LedgerService } from './ledger.service';

const querySchema = z.object({ organisationId: z.string().uuid() });

@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  /**
   * There is no endpoint that totals across entry kinds, and there must not be
   * one (§5.7 P0). The screen groups by kind; the API returns rows.
   *
   * No ownership check here: `ledger_entries_member` is what scopes the read,
   * so an id belonging to someone else returns an empty list.
   */
  @RequiresRole('libya_doctor', 'tunisia_doctor', 'admin')
  @Get()
  async list(@Query() query: unknown): Promise<{ entries: LedgerEntry[] }> {
    const { organisationId } = querySchema.parse(query);
    return { entries: await this.ledger.listForOrganisation(organisationId) };
  }
}
