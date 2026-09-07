import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/db/database.module';
import { EventsModule } from '../../shared/events/events.module';
import { LedgerModule } from '../ledger';
import { PricingModule } from '../pricing';
import { CasesController } from './internal/cases.controller';
import { CasesMaintenance } from './internal/cases.maintenance';
import { CasesService } from './internal/cases.service';
import { DirectoryService } from './internal/directory.service';

@Module({
  imports: [DatabaseModule, EventsModule, LedgerModule, PricingModule],
  controllers: [CasesController],
  providers: [CasesService, CasesMaintenance, DirectoryService],
  exports: [CasesService, DirectoryService],
})
export class CasesModule {}
