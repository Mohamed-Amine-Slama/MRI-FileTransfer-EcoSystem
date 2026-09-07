import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/db/database.module';
import { LedgerController } from './internal/ledger.controller';
import { LedgerService } from './internal/ledger.service';

@Module({
  imports: [DatabaseModule],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
