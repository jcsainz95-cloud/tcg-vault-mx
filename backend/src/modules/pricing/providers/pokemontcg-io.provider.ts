import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductType } from '@prisma/client';
import {
  FINISH_TO_TCG_KEY,
  FreshCardPriceProvider,
  FreshCardPriceResult,
  FreshCardPriceRow,
  FreshCardRef,
  PriceQuote,
  PricingProvider,
  PricingProviderInput,
} from '../pricing.types';

/**
 * PokemonTcgIoProvider — raw/singles. TCGPlayer "Market Price" vía pokemontcg.io.
 * ARCHITECTURE §4.1. Solo pricea cartas en bóveda (el llamador lo garantiza).
 *
 * v1.26 (P-7 ⑤, §4.24e): implementa además `FreshCardPriceProvider` — el FALLBACK del fetch fresco
 * puntual por carta (keyeado por `externalId`; pokemontcg.io no tiene cuota diaria dura como PPT).
 */
@Injectable()
export class PokemonTcgIoProvider implements PricingProvider, FreshCardPriceProvider {
  readonly source = 'pokemontcg_io' as const;
  private readonly logger = new Logger(PokemonTcgIoProvider.name);
  /**
   * SEGURIDAD L2 — timeout corto por petición (paridad con `TcgcsvHttpClient`): un upstream colgado o
   * que redirige no debe estancar un `repriceFresh`. Se combina con `redirect:'error'` en el fetch.
   */
  private readonly timeoutMs = 15_000;

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

  /**
   * v1.26 (P-7 ⑤, §4.24e) — fetch FRESCO puntual (FALLBACK). Una petición por carta (por `externalId`),
   * de la que se leen TODOS los acabados pedidos. pokemontcg.io publica en USD → `currency:'USD'`
   * (el llamador aplica FX+colchón). Money-safe: una carta/acabado sin `market>0` NO produce fila
   * (se queda pending); un fallo de red no borra nada (`requestOk` refleja si algo respondió OK).
   * NO tiene cuota diaria dura (rate-limit del free tier) ⇒ `dailyLimited` siempre `false`.
   */
  async fetchFreshForCards(cards: FreshCardRef[]): Promise<FreshCardPriceResult> {
    const apiKey = this.config.get<string>('POKEMONTCG_IO_API_KEY');
    const rows: FreshCardPriceRow[] = [];
    let requestOk = false;
    for (const card of cards) {
      if (!card.externalId) continue;
      // SEGURIDAD L2 — timeout + `redirect:'error'` por carta (paridad con TcgcsvHttpClient): un upstream
      // colgado/redirigiendo no estanca el `repriceFresh`. Host fijo (no se cambia).
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(`https://api.pokemontcg.io/v2/cards/${card.externalId}`, {
          headers: apiKey ? { 'X-Api-Key': apiKey } : {},
          redirect: 'error',
          signal: controller.signal,
        });
        if (!res.ok) {
          this.logger.warn(`pokemontcg.io fresh ${card.externalId} -> HTTP ${res.status}`);
          continue;
        }
        requestOk = true;
        const body = (await res.json()) as {
          data?: { tcgplayer?: { prices?: Record<string, { market?: number }> } };
        };
        const prices = body.data?.tcgplayer?.prices;
        if (!prices) continue;
        for (const finish of card.finishes) {
          const variant = prices[FINISH_TO_TCG_KEY[finish]];
          if (variant && typeof variant.market === 'number' && variant.market > 0) {
            rows.push({
              cardId: card.cardId,
              finish,
              marketCents: Math.round(variant.market * 100),
              currency: 'USD',
              source: this.source,
            });
          }
        }
      } catch (e) {
        this.logger.warn(`pokemontcg.io fresh failed for ${card.externalId}: ${(e as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
    }
    return { rows, requestOk, dailyLimited: false };
  }
}
