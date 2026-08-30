import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { SetValueService } from './set-value.service';
import { SealedCatalogService } from './sealed-catalog.service';
import { SealedRestockNotifyService } from './sealed-restock-notify.service';
import { CatalogController } from './catalog.controller';
import { AdminCatalogController } from './admin-catalog.controller';
// v1.44-graded-estimate (§M2 / §4.35d): diales del gancho + diagnóstico de curaduría. Vive aquí (y no en
// PricingController) porque el `/preview` compone los grupos raw publicados vía CatalogService, y
// CatalogModule ya importa PricingModule (al revés sería un ciclo).
import { GradedEstimatesController } from './graded-estimates.controller';
import { CatalogSyncService } from './catalog-sync.service';
import { PokemonTcgIoClient } from './pokemontcg-io.client';
import { PricingModule } from '../pricing/pricing.module';
import { FinishReconcilerModule } from './finish-reconciler.module';
// v1.29 (§4.27d): resolver de «1 carta ↔ N productos» desde TCGCSV + su cliente HTTP (hermano del
// provider sellado). Vive en el módulo catalog porque el paso corre dentro de `importSet`.
import { CardProductResolverService } from './card-product-resolver.service';
import { TcgcsvCatalogClient } from '../pricing/providers/tcgcsv-singles.provider';
import { SetPriceSyncJobService } from '../../jobs/set-price-sync.service';
import { SetValueSnapshotJobService } from '../../jobs/set-value-snapshot.service';
import { CatalogPriceSyncJobService } from '../../jobs/catalog-price-sync.service';

/**
 * CatalogModule — Catálogo (M2) + gráfica PÚBLICA del valor de set (v1.9-set-chart). Aloja
 * `SetValueService` y los jobs `set-price-sync`/`set-value-snapshot` (dependen de PricingService/
 * SetValueService, por eso viven aquí para evitar ciclos con JobsModule, patrón portfolio-snapshot).
 */
@Module({
  imports: [PricingModule, FinishReconcilerModule], // SettingsModule/AuditModule/PrismaModule/ConfigModule son @Global
  providers: [
    CatalogService,
    CatalogSyncService,
    PokemonTcgIoClient,
    // v1.29 (§4.27d): TCGCSV card-product resolver + su cliente HTTP (stateless).
    CardProductResolverService,
    TcgcsvCatalogClient,
    SetValueService,
    SealedCatalogService,
    SealedRestockNotifyService,
    SetPriceSyncJobService,
    SetValueSnapshotJobService,
    // v1.12-catalog-pricing (§4.13c): vive aquí porque depende de CatalogSyncService (evita ciclos
    // con JobsModule, mismo patrón que set-price-sync).
    CatalogPriceSyncJobService,
  ],
  controllers: [CatalogController, AdminCatalogController, GradedEstimatesController],
  exports: [
    CatalogService,
    SetValueService,
    SealedCatalogService,
    SealedRestockNotifyService,
    SetPriceSyncJobService,
    SetValueSnapshotJobService,
    CatalogPriceSyncJobService,
  ],
})
export class CatalogModule {}
