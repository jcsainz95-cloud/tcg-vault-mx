import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductType } from '@prisma/client';
import {
  FINISH_TO_TCG_KEY,
  PriceQuote,
  PricingProvider,
  PricingProviderInput,
} from '../pricing.types';

/**
 * PokemonTcgIoProvider — raw/singles. TCGPlayer "Market Price" vía pokemontcg.io.
 * ARCHITECTURE §4.1. Solo pricea cartas en bóveda (el llamador lo garantiza).
 */
@Injectable()
export class PokemonTcgIoProvider implements PricingProvider {
  readonly source = 'pokemontcg_io' as const;
  private readonly logger = new Logger(PokemonTcgIoProvider.name);

  constructor(private readonly config: ConfigService) {}

  supports(productType: ProductType): boolean {
    return productType === 'raw';
  }

  async fetchPrice(input: PricingProviderInput): Promise<PriceQuote | null> {
    const apiKey = this.config.get<string>('POKEMONTCG_IO_API_KEY');
    const externalId = input.card.externalId;
    try {
      const res = await fetch(`https://api.pokemontcg.io/v2/cards/${externalId}`, {
        headers: apiKey ? { 'X-Api-Key': apiKey } : {},
      });
      if (!res.ok) {
        this.logger.warn(`pokemontcg.io ${externalId} -> HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as {
        data?: { tcgplayer?: { prices?: Record<string, { market?: number }> } };
      };
      const prices = body.data?.tcgplayer?.prices;
      if (!prices) return null;
      // v1.6-finish: lee el "market" del ACABADO pedido (no el primero disponible). Mapea
      // finish → llave de tcgplayer.prices (ARCHITECTURE §4.1). Si esa llave no existe → null
      // → "precio pendiente" para ese acabado.
      const key = FINISH_TO_TCG_KEY[input.finish];
      const variant = prices[key];
      if (variant && typeof variant.market === 'number' && variant.market > 0) {
        return { priceUsdCents: Math.round(variant.market * 100), source: this.source };
      }
      return null;
    } catch (e) {
      this.logger.warn(`pokemontcg.io fetch failed for ${externalId}: ${(e as Error).message}`);
      return null;
    }
  }
}
