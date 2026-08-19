import { Injectable, Logger } from '@nestjs/common';
import { CardSet, PriceSource } from '@prisma/client';
import { PokemonTcgIoClient, RemoteCard } from '../../catalog/pokemontcg-io.client';
import {
  BulkPriceProvider,
  BulkPriceResult,
  BulkPriceRow,
  TCG_KEY_TO_FINISH,
} from '../pricing.types';

/**
 * PokemonTcgIoBulkProvider — implementación LEGACY/alterno del `BulkPriceProvider`
 * (WS-A, ARCHITECTURE §4.15b). Envuelve el `PokemonTcgIoClient.getCardsBySet` existente
 * (paginado) y extrae `tcgplayer.prices[llave].market` por acabado, detrás de la interfaz bulk.
 *
 * Permite `PRICE_PROVIDER=pokemontcg_io` como ROLLBACK money-safe (sin la key del proveedor de
 * paga): el job de ingest ya es robusto (fan-out por set, reanudable) incluso con esta fuente.
 *
 * Money-safe: solo emite filas con `market > 0`; el acabado se deriva de la llave real de
 * `tcgplayer.prices` (mapeo canónico `TCG_KEY_TO_FINISH`); llaves no mapeadas se OMITEN. La
 * moneda es siempre `USD` (TCGPlayer Market Price) → el ingest aplica FX+colchón.
 */
@Injectable()
export class PokemonTcgIoBulkProvider implements BulkPriceProvider {
  readonly source: PriceSource = 'pokemontcg_io';
  private readonly logger = new Logger(PokemonTcgIoBulkProvider.name);
  /** Cota dura de páginas para no colgarse ante un totalCount corrupto. */
  private readonly maxPages = 40;

  constructor(private readonly client: PokemonTcgIoClient) {}

  async fetchPricesForSet(input: { set: CardSet }): Promise<BulkPriceResult> {
    const setExternalId = input.set.externalId;
    const rows: BulkPriceRow[] = [];
    let fetchedRaw = 0;
    let skipped = 0;
    let requestOk = false;

    let page = 1;
    let totalPages = 1;
    try {
      do {
        const res = await this.client.getCardsBySet(setExternalId, page);
        requestOk = true;
        const cards = res.data ?? [];
        fetchedRaw += cards.length;
        for (const c of cards) {
          const { added, dropped } = this.mapCard(c, setExternalId);
          rows.push(...added);
          skipped += dropped;
        }
        if (page === 1) {
          totalPages = Math.min(
            this.maxPages,
            Math.max(1, Math.ceil((res.totalCount || 0) / (res.pageSize || 250))),
          );
        }
        page += 1;
      } while (page <= totalPages);
    } catch (e) {
      // Money-safe: ante un fallo del remoto NO borramos precios; devolvemos lo acumulado + log.
      this.logger.warn(
        `pokemontcg_io bulk: set ${setExternalId} falló en pág ${page}: ${(e as Error).message}. ` +
          `Se devuelven ${rows.length} filas acumuladas (precios previos quedan STALE, no se borran).`,
      );
    }
    // v1.22-1 (§4.22g): esta fuente deriva el acabado SOLO de las llaves REALES de tcgplayer.prices
    // (`TCG_KEY_TO_FINISH`), que son exactamente los alias VERIFICADOS → `finishAliasVerified` de sus
    // filas es siempre `true` (ver `mapCard`). `requestOk` habilita el reemplazo de snapshots.
    return { rows, fetchedRaw, skipped, requestOk };
  }

  /** Extrae una fila por acabado con `market > 0`; cuenta las llaves omitidas. */
  private mapCard(c: RemoteCard, setExternalId: string): { added: BulkPriceRow[]; dropped: number } {
    const added: BulkPriceRow[] = [];
    let dropped = 0;
    const prices = c?.tcgplayer?.prices;
    if (!c?.id || !prices) return { added, dropped };
    for (const [tcgKey, variant] of Object.entries(prices)) {
      const finish = TCG_KEY_TO_FINISH[tcgKey];
      const market = variant?.market;
      // Money-safe: llave no mapeada, o market ausente/<=0/NaN → se OMITE (no crea fila basura).
      if (!finish || typeof market !== 'number' || !Number.isFinite(market) || market <= 0) {
        dropped += 1;
        continue;
      }
      added.push({
        externalId: c.id,
        setExternalId,
        number: c.number ?? null,
        finish,
        marketCents: Math.round(market * 100),
        currency: 'USD',
        // El acabado vino de una llave REAL de tcgplayer.prices (TCG_KEY_TO_FINISH) = alias
        // VERIFICADO por construcción (§4.22g candado 2): apto para la lista blanca.
        finishAliasVerified: true,
      });
    }
    return { added, dropped };
  }
}
