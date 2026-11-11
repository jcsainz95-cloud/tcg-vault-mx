import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { CatalogService } from './catalog.service';
import { SealedCatalogService } from './sealed-catalog.service';
import { MERCHANT_SERVER_CACHE_MS, MerchantFeedResponse, MerchantShippingRule, buildMerchantFeed } from './merchant-feed';

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

  private cache: { at: number; value: MerchantFeedResponse & { skipped: number } } | null = null;
  private inflight: Promise<MerchantFeedResponse & { skipped: number }> | null = null;

  /** Caché de servidor de 5 min (un solo cómputo por ventana, GS-2); un resultado con 0 ítems no se cachea. */
  async build(): Promise<MerchantFeedResponse & { skipped: number }> {
    const c = this.cache;
    if (c && Date.now() - c.at < MERCHANT_SERVER_CACHE_MS) return c.value;
    if (this.inflight) return this.inflight;
    this.inflight = this.compute()
      .then((v) => {
        if (v.items.length > 0) this.cache = { at: Date.now(), value: v };
        return v;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async compute(): Promise<MerchantFeedResponse & { skipped: number }> {
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
