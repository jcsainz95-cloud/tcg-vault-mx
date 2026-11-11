import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { CatalogService } from './catalog.service';
import { SealedCatalogService } from './sealed-catalog.service';
import { MerchantFeedResponse, MerchantShippingRule, buildMerchantFeed } from './merchant-feed';

/**
 * §GSHOP.B — feed de Google Merchant Center (`GET /catalog/merchant-feed`). Solo lectura: compone los insumos de singles y
 * sellado (misma regla de «vendible» que el sitemap) con la regla VIVA de envío (los mismos diales de `/checkout/shipping-rule`).
 */
@Injectable()
export class MerchantFeedService {
  private readonly logger = new Logger('MerchantFeedService');

  constructor(
    private readonly catalog: CatalogService,
    private readonly sealed: SealedCatalogService,
    private readonly settings: SettingsService,
  ) {}

  async build(): Promise<MerchantFeedResponse & { skipped: number }> {
    const [cards, sealed, rule] = await Promise.all([
      this.catalog.merchantFeedCardRows(),
      this.sealed.merchantFeedSealedRows(),
      this.shippingRule(),
    ]);
    const { items, skipped } = buildMerchantFeed([...cards, ...sealed], rule);
    this.logger.log(`merchant-feed: ${items.length} ítems, ${skipped} omitidos`);
    return { items, skipped, generatedAt: new Date().toISOString() };
  }

  private async shippingRule(): Promise<MerchantShippingRule> {
    const [cardsOnlyFeeCents, sealedFeeCents, freeFromCents] = await Promise.all([
      this.settings.getNumber(SettingKey.DIRECT_SHIP_CARDS_FEE_CENTS),
      this.settings.getNumber(SettingKey.DIRECT_SHIP_SEALED_FEE_CENTS),
      this.settings.getNumber(SettingKey.DIRECT_SHIP_FREE_FROM_CENTS),
    ]);
    return { cardsOnlyFeeCents, sealedFeeCents, freeFromCents };
  }
}
