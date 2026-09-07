import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/db/database.module';
import { EventsModule } from '../../shared/events/events.module';
import { LedgerModule } from '../ledger';
import { SchedulingController } from './internal/scheduling.controller';
import { SchedulingMaintenance } from './internal/scheduling.maintenance';
import { SchedulingService } from './internal/scheduling.service';

@Module({
  imports: [DatabaseModule, EventsModule, LedgerModule],
  controllers: [SchedulingController],
  providers: [SchedulingService, SchedulingMaintenance],
  exports: [SchedulingService],
})
export class SchedulingModule {}
