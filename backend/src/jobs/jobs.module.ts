import { Module } from '@nestjs/common';
import { BuylistSweepJobService } from './buylist-sweep.service';
import { DisputeDeadlineJobService } from './dispute-deadline.service';
import { IneRetentionJobService } from './ine-retention.service';
import { PricingModule } from '../modules/pricing/pricing.module';
import { UploadsModule } from '../modules/uploads/uploads.module';

/**
 * JobsModule — Agrupa los jobs que no dependen de PricingService (buylist-sweep,
 * dispute-deadline, ine-retention). Re-exporta los de pricing (price-sync, fx-refresh)
 * vía PricingModule para el scheduler. La programación repetible BullMQ es un wrapper
 * de despliegue; ver docs/BACKEND_NOTES.md.
 */
@Module({
  imports: [PricingModule, UploadsModule],
  providers: [BuylistSweepJobService, DisputeDeadlineJobService, IneRetentionJobService],
  exports: [
    BuylistSweepJobService,
    DisputeDeadlineJobService,
    IneRetentionJobService,
    PricingModule,
  ],
})
export class JobsModule {}
