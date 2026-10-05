import { Module } from '@nestjs/common';
import { BuylistSweepJobService } from './buylist-sweep.service';
import { DisputeDeadlineJobService } from './dispute-deadline.service';
import { IneRetentionJobService } from './ine-retention.service';
import { AuthTokenSweepJobService } from './auth-token-sweep.service';
import { OrderReservationSweepJobService } from './order-reservation-sweep.service';
import { SchedulerService } from './scheduler.service';
import { AdminJobsController } from './admin-jobs.controller';
import { PricingModule } from '../modules/pricing/pricing.module';
import { UploadsModule } from '../modules/uploads/uploads.module';
import { VaultModule } from '../modules/vault/vault.module';
import { CatalogModule } from '../modules/catalog/catalog.module';
import { OrdersModule } from '../modules/orders/orders.module';
// DECKS-META Fase 2 (§7): el scheduler programa `decks-meta-refresh` semanal y el disparo manual
// admin delega en `DecksMetaRefreshService`, exportado por DecksMetaModule.
import { DecksMetaModule } from '../modules/decks-meta/decks-meta.module';
// ⭐💰 D2d (API_CONTRACT §M4-SHIP.19.10): los tres jobs de Skydropx viven en `shipments/` (su dominio) y se exportan desde
// `ShipmentsModule`; aquí solo se programan y se disparan. Sin ciclo: `ShipmentsModule` no importa `JobsModule`.
import { ShipmentsModule } from '../modules/shipments/shipments.module';
// 💰 C1 (API_CONTRACT §M4-SHIP.19.33.9): `spend-watch` y `spend-digest` viven en `spend-alerts/` (su dominio) y se exportan desde
// `SpendAlertsModule`; aquí solo se programan y se disparan. Sin ciclo: `SpendAlertsModule` no importa `JobsModule`.
import { SpendAlertsModule } from '../modules/spend-alerts/spend-alerts.module';

/**
 * JobsModule — Jobs de barrido (buylist-sweep, dispute-deadline, ine-retention,
 * auth-token-sweep) + los diarios de pricing/valuación (price-sync, fx-refresh,
 * portfolio-snapshot) y el SCHEDULER BullMQ (BE-5 / v15-D1) que programa **los 7** en cron.
 * Todos son disparables a mano por AdminJobsController (`POST /admin/jobs/*`). Importa
 * PricingModule (price-sync/fx-refresh) y VaultModule (portfolio-snapshot). El scheduler
 * solo se activa si hay REDIS_URL (ver scheduler.service).
 */
@Module({
  // OrdersModule: `order-reservation-sweep` (v1.68) delega en OrdersService (barrido por
  // `reservedUntil`, dos rutas) y en GuestCheckoutService (rama legada). Sin ciclo: OrdersModule no
  // importa JobsModule.
  imports: [PricingModule, UploadsModule, VaultModule, CatalogModule, OrdersModule, DecksMetaModule, ShipmentsModule, SpendAlertsModule],
  providers: [
    BuylistSweepJobService,
    DisputeDeadlineJobService,
    IneRetentionJobService,
    AuthTokenSweepJobService,
    OrderReservationSweepJobService,
    SchedulerService,
  ],
  controllers: [AdminJobsController],
  exports: [
    BuylistSweepJobService,
    DisputeDeadlineJobService,
    IneRetentionJobService,
    AuthTokenSweepJobService,
    OrderReservationSweepJobService,
    PricingModule,
  ],
})
export class JobsModule {}
