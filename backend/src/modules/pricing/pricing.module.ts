import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
// v1.28 (P-18/P-22, §4.26): consola de controles de precio por variante (M-30).
import { VariantControlsService } from './variant-controls.service';
import { FxService } from './fx.service';
import { PricingController, FxController } from './pricing.controller';
import { PokemonTcgIoProvider } from './providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from './providers/graded-sealed.providers';
import { PriceSyncJobService } from '../../jobs/price-sync.service';
import { FxRefreshJobService } from '../../jobs/fx-refresh.service';
// WS-A (v1.14-price-ingest, §4.15): ingesta MASIVA de precios (BulkPriceProvider + PriceIngest).
import { PokemonTcgIoClient } from '../catalog/pokemontcg-io.client';
import { PokemonPriceTrackerBulkProvider } from './providers/pokemonpricetracker-bulk.provider';
import { PokemonTcgIoBulkProvider } from './providers/pokemontcg-io-bulk.provider';
// WS-A fix-ppt (2026-08-19): cliente HTTP con throttle + resolvedor de `CardSet.pptSetId`.
import { PptApiClient } from './providers/ppt-api.client';
import { PptSetMapper } from './ppt-set-mapper.service';
import { PriceIngestService } from './price-ingest.service';
import { PriceIngestJobService } from '../../jobs/price-ingest.service';
// v1.19-sealed-tcgcsv (§4.19): referencia de mercado del SELLADO vía TCGCSV.
import { TcgcsvSealedBulkProvider } from './providers/tcgcsv-sealed.provider';
import { SealedPriceIngestService } from './sealed-price-ingest.service';
import { SealedMappingService } from './sealed-mapping.service';
import { SealedPricingController } from './sealed-pricing.controller';
import { SealedPriceIngestJobService } from '../../jobs/sealed-price-ingest.service';
// v1.22-1 (§4.22g/§4.22h): `price-ingest` escribe `pricedFinishesSnapshot` y LLAMA al ÚNICO escritor
// de `availableFinishes`. Se importa el módulo del reconciliador (compartido con CatalogModule sin ciclo).
import { FinishReconcilerModule } from '../catalog/finish-reconciler.module';

/**
 * PricingModule — M2. Providers intercambiables, FxService, PricingService y los
 * jobs price-sync/fx-refresh (que dependen de PricingService/FxService y por eso
 * viven aquí para evitar ciclos con JobsModule).
 *
 * WS-A: aloja además la ingesta masiva de precios (§4.15): los dos `BulkPriceProvider`, el
 * `PriceIngestService` y su `PriceIngestJobService` (fan-out BullMQ / secuencial). Se proveen y
 * exportan aquí (patrón price-sync/fx-refresh) para que JobsModule/SchedulerService/AdminJobs los
 * inyecten sin ciclos. `PokemonTcgIoClient` es stateless (solo ConfigService) → se provee también
 * aquí para el bulk legacy (instancia propia; NO crea ciclo con CatalogModule).
 */
@Module({
  imports: [FinishReconcilerModule],
  providers: [
    PricingService,
    VariantControlsService,
    FxService,
    PokemonTcgIoProvider,
    PokemonPriceTrackerProvider,
    PokeTraceProvider,
    PriceSyncJobService,
    FxRefreshJobService,
    PokemonTcgIoClient,
    PptApiClient,
    PptSetMapper,
    PokemonPriceTrackerBulkProvider,
    PokemonTcgIoBulkProvider,
    PriceIngestService,
    PriceIngestJobService,
    // v1.19-sealed-tcgcsv (§4.19): adapter + ingest + curación del mapeo + su job (mismo
    // patrón price-ingest: viven aquí para que JobsModule/Scheduler los inyecten sin ciclos).
    TcgcsvSealedBulkProvider,
    SealedPriceIngestService,
    SealedMappingService,
    SealedPriceIngestJobService,
  ],
  controllers: [PricingController, FxController, SealedPricingController],
  exports: [
    PricingService,
    FxService,
    PriceSyncJobService,
    FxRefreshJobService,
    PriceIngestService,
    PriceIngestJobService,
    SealedPriceIngestService,
    SealedPriceIngestJobService,
  ],
})
export class PricingModule {}
