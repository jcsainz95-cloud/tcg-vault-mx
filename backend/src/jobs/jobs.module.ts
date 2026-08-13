import { Module } from '@nestjs/common';
import { BuylistSweepJobService } from './buylist-sweep.service';
import { DisputeDeadlineJobService } from './dispute-deadline.service';
import { PricingModule } from '../modules/pricing/pricing.module';

/**
 * JobsModule — Agrupa los jobs que no dependen de PricingService (buylist-sweep,
 * dispute-deadline). Re-exporta los de pricing (price-sync, fx-refresh) vía
 * PricingModule para el scheduler. La programación repetible BullMQ es un wrapper
 * de despliegue; ver docs/BACKEND_NOTES.md.
 */
@Module({
  imports: [PricingModule],
  providers: [BuylistSweepJobService, DisputeDeadlineJobService],
  exports: [BuylistSweepJobService, DisputeDeadlineJobService, PricingModule],
})
export class JobsModule {}
