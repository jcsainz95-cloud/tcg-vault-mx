import { Module } from '@nestjs/common';
import { BuylistSweepJobService } from './buylist-sweep.service';
import { DisputeDeadlineJobService } from './dispute-deadline.service';
import { IneRetentionJobService } from './ine-retention.service';
import { AuthTokenSweepJobService } from './auth-token-sweep.service';
import { SchedulerService } from './scheduler.service';
import { AdminJobsController } from './admin-jobs.controller';
import { PricingModule } from '../modules/pricing/pricing.module';
import { UploadsModule } from '../modules/uploads/uploads.module';
import { VaultModule } from '../modules/vault/vault.module';
import { CatalogModule } from '../modules/catalog/catalog.module';

/**
 * JobsModule — Jobs de barrido (buylist-sweep, dispute-deadline, ine-retention,
 * auth-token-sweep) + los diarios de pricing/valuación (price-sync, fx-refresh,
 * portfolio-snapshot) y el SCHEDULER BullMQ (BE-5 / v15-D1) que programa **los 7** en cron.
 * Todos son disparables a mano por AdminJobsController (`POST /admin/jobs/*`). Importa
 * PricingModule (price-sync/fx-refresh) y VaultModule (portfolio-snapshot). El scheduler
 * solo se activa si hay REDIS_URL (ver scheduler.service).
 */
@Module({
  imports: [PricingModule, UploadsModule, VaultModule, CatalogModule],
  providers: [
    BuylistSweepJobService,
    DisputeDeadlineJobService,
    IneRetentionJobService,
    AuthTokenSweepJobService,
    SchedulerService,
  ],
  controllers: [AdminJobsController],
  exports: [
    BuylistSweepJobService,
    DisputeDeadlineJobService,
    IneRetentionJobService,
    AuthTokenSweepJobService,
    PricingModule,
  ],
})
export class JobsModule {}
