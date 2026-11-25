import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { PublicSnapshotService } from './public-snapshot.service';
import { MerchantFeedResponse, MerchantShippingRule, buildMerchantFeed } from './merchant-feed';

/**
 * §GSHOP.B — feed de Google Merchant Center (`GET /catalog/merchant-feed`). Solo lectura: compone los insumos de singles y
 * sellado (la MISMA foto de «vendible» que el sitemap) con la regla VIVA de envío (los mismos diales de `/checkout/shipping-rule`).
 */
@Injectable()
export class MerchantFeedService {
  private readonly logger = new Logger('MerchantFeedService');

  constructor(
    private readonly snapshot: PublicSnapshotService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * El feed sale de la MISMA foto que el sitemap (`PublicSnapshotService`, TTL 60 s): ⛔ ya no hay una caché propia de 5 min
   * con su propia lectura. Un resultado con 0 ítems no se cachea (lo decide la foto).
   */
  async build(): Promise<MerchantFeedResponse & { skipped: number }> {
    const [snap, rule] = await Promise.all([this.snapshot.get(), this.shippingRule()]);
    const { items, skipped } = buildMerchantFeed(snap.feedRows, rule);
    this.logger.log(`merchant-feed: ${items.length} ítems, ${skipped} omitidos`);
    return { items, skipped, generatedAt: snap.generatedAt };
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
