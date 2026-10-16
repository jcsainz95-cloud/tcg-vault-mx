/**
 * MarketingModule — Panel de Marketing Fase 0 (ARCHITECTURE §13.4/§13.5; API_CONTRACT §MKT.D/E).
 * Compone `SalesAnalyticsModule` para las cifras de dinero (⛔ no lo modifica). Exporta
 * `MarketingQuoteCounterService` para que `buylist` enganche el conteo anónimo d4 SIN acoplarse al
 * resto del panel. Prisma es @Global ⇒ sin ciclo con buylist.
 */
import { Module } from '@nestjs/common';
import { SalesAnalyticsModule } from '../sales-analytics/sales-analytics.module';
import { MarketingController } from './marketing.controller';
import { MarketingAnalyticsService } from './marketing-analytics.service';
import { MarketingTokenService } from './marketing-token.service';
import { MarketingAccessLogService } from './marketing-access-log.service';
import { MarketingQuoteCounterService } from './marketing-quote-counter.service';
import { MarketingExportService } from './export/marketing-export.service';

@Module({
  imports: [SalesAnalyticsModule],
  controllers: [MarketingController],
  providers: [
    MarketingAnalyticsService,
    MarketingTokenService,
    MarketingAccessLogService,
    MarketingQuoteCounterService,
    MarketingExportService,
  ],
  // `MarketingQuoteCounterService` lo usa el controller de buylist (d4); el resto es interno.
  exports: [MarketingQuoteCounterService],
})
export class MarketingModule {}
