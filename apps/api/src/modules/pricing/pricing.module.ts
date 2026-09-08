import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/db/database.module';
import { PricingService } from './internal/pricing.service';

@Module({
  imports: [DatabaseModule],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
