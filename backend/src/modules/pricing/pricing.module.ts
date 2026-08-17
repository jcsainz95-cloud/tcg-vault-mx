import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
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
import { PriceIngestService } from './price-ingest.service';
import { PriceIngestJobService } from '../../jobs/price-ingest.service';

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
  providers: [
    PricingService,
    FxService,
    PokemonTcgIoProvider,
    PokemonPriceTrackerProvider,
    PokeTraceProvider,
    PriceSyncJobService,
    FxRefreshJobService,
    PokemonTcgIoClient,
    PokemonPriceTrackerBulkProvider,
    PokemonTcgIoBulkProvider,
    PriceIngestService,
    PriceIngestJobService,
  ],
  controllers: [PricingController, FxController],
  exports: [
    PricingService,
    FxService,
    PriceSyncJobService,
    FxRefreshJobService,
    PriceIngestService,
    PriceIngestJobService,
  ],
})
export class PricingModule {}
