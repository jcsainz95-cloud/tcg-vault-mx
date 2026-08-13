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

/**
 * PricingModule — M2. Providers intercambiables, FxService, PricingService y los
 * jobs price-sync/fx-refresh (que dependen de PricingService/FxService y por eso
 * viven aquí para evitar ciclos con JobsModule).
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
  ],
  controllers: [PricingController, FxController],
  exports: [PricingService, FxService, PriceSyncJobService, FxRefreshJobService],
})
export class PricingModule {}
