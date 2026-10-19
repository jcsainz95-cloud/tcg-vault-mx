/**
 * MarketingModule — Panel de Marketing Fase 0 (ARCHITECTURE §13.4/§13.5; API_CONTRACT §MKT.D/E).
 * Compone `SalesAnalyticsModule` para las cifras de dinero (⛔ no lo modifica). Exporta
 * `MarketingQuoteCounterService` para que `buylist` enganche el conteo anónimo d4 SIN acoplarse al
 * resto del panel. Prisma es @Global ⇒ sin ciclo con buylist.
 */
import { Module } from '@nestjs/common';
import { SalesAnalyticsModule } from '../sales-analytics/sales-analytics.module';
import { MarketingController } from './marketing.controller';
import { MarketingAnnotationsController } from './marketing-annotations.controller';
import { MarketingAnalyticsService } from './marketing-analytics.service';
import { MarketingAnnotationsService } from './marketing-annotations.service';
import { MarketingTokenService } from './marketing-token.service';
import { MarketingTokenAdminService } from './marketing-token-admin.service';
import { MarketingTokensController } from './marketing-tokens.controller';
import { MarketingAccessLogService } from './marketing-access-log.service';
import { MarketingQuoteCounterService } from './marketing-quote-counter.service';
import { MarketingExportService } from './export/marketing-export.service';
// v1.102⟨mkt-fase2⟩ (§MKT.H.9): lectura de GA4 Data API / Search Console (fail-closed sin credenciales).
import { GOOGLE_READ_PORT, MarketingExternalSources, googleAuthReadPort } from './marketing-external-sources';

@Module({
  imports: [SalesAnalyticsModule],
  controllers: [MarketingController, MarketingAnnotationsController, MarketingTokensController],
  providers: [
    MarketingAnalyticsService,
    MarketingAnnotationsService,
    MarketingTokenService,
    MarketingTokenAdminService,
    MarketingAccessLogService,
    MarketingQuoteCounterService,
    MarketingExportService,
    MarketingExternalSources,
    { provide: GOOGLE_READ_PORT, useValue: googleAuthReadPort },
  ],
  // `MarketingQuoteCounterService` lo usa el controller de buylist (d4); `MarketingAccessLogService` lo usa el
  // planificador (retención de 12 meses, §13.4.4); el resto es interno.
  exports: [MarketingQuoteCounterService, MarketingAccessLogService],
})
export class MarketingModule {}
