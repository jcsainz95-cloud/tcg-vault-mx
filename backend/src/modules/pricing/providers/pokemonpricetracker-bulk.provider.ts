import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CardSet, PriceSource } from '@prisma/client';
import {
  BulkPriceProvider,
  BulkPriceResult,
  BulkPriceRow,
  normalizeFinishAlias,
} from '../pricing.types';

/**
 * PokemonPriceTrackerBulkProvider — implementación PRIMARIA del `BulkPriceProvider`
 * (WS-A, ARCHITECTURE §4.15b). Consume el endpoint BULK del proveedor de PAGA:
 *
 *   POST https://www.pokemonpricetracker.com/api/v1/cards/bulk-price
 *   Authorization: Bearer <POKEMONPRICETRACKER_API_KEY>
 *   body { set: <CardSet.externalId>, limit }
 *
 * SEGURIDAD:
 *  - **Host FIJO** (`www.pokemonpricetracker.com`, sin parte controlable) → sin SSRF (patrón
 *    `PokemonTcgIoClient`). El cliente NUNCA acepta URLs arbitrarias.
 *  - La API key se lee SOLO de `process.env.POKEMONPRICETRACKER_API_KEY` (vía ConfigService).
 *    NUNCA se hardcodea, se loguea ni se commitea (repo público).
 *
 * MONEY-SAFE (ARCHITECTURE §4.15d): el adapter mapea el payload CRUDO → `BulkPriceRow[]`
 * DEFENSIVAMENTE y OMITE lo mal formado (nunca NaN/negativo/cero/variante desconocida):
 *  - `market` numérico **> 0** (descarta 0/negativo/NaN/ausente).
 *  - variante → `Finish` por `normalizeFinishAlias` (tabla conservadora); variante DESCONOCIDA →
 *    se OMITE (jamás se atribuye un precio holo a `normal`).
 *  - Sin key / key inválida → devuelve `{ rows: [], ... }` + log (el ingest NO escribe ese set:
 *    los precios quedan STALE, que es seguro, en vez de borrarse).
 *
 * ⚠️ ESQUEMA EXACTO A VERIFICAR EN LA 1ª CORRIDA EN RAILWAY (dominio bloqueado en dev por egress).
 * Todos los campos marcados `SUPUESTO` abajo se confirman con el `LOG de ejemplo` de la 1ª respuesta.
 * Por eso el dial `PRICE_PROVIDER` se siembra en `pokemontcg_io` (legacy): el flip a este proveedor
 * lo hace el humano tras verificar el esquema (ARCHITECTURE §4.15h, decisión abierta v1.14-1/4).
 */
@Injectable()
export class PokemonPriceTrackerBulkProvider implements BulkPriceProvider {
  readonly source: PriceSource = 'pokemonpricetracker';
  private readonly logger = new Logger(PokemonPriceTrackerBulkProvider.name);
  /** Host FIJO — no configurable por el usuario (anti-SSRF). */
  private readonly baseUrl = 'https://www.pokemonpricetracker.com/api/v1';
  /** Tamaño de página del bulk (SUPUESTO: el endpoint acepta `limit`; verificar 1ª corrida). */
  private readonly pageLimit = 250;
  /** Cota dura de páginas (anti-bucle si la paginación del proveedor no converge). */
  private readonly maxPages = 40;

  constructor(private readonly config: ConfigService) {}

  async fetchPricesForSet(input: { set: CardSet }): Promise<BulkPriceResult> {
    const apiKey = this.config.get<string>('POKEMONPRICETRACKER_API_KEY');
    if (!apiKey || apiKey === 'CHANGE_ME') {
      // Sin key → NO revienta y NO escribe (precios quedan stale, money-safe). §4.15b/§4.15h.
      this.logger.warn(
        'PokemonPriceTracker bulk: falta POKEMONPRICETRACKER_API_KEY → no se ingesta ' +
          `(precios STALE, no se borran). Set ${input.set.externalId}.`,
      );
      return { rows: [], fetchedRaw: 0, skipped: 0 };
    }

    const setExternalId = input.set.externalId;
    const rows: BulkPriceRow[] = [];
    let fetchedRaw = 0;
    let skipped = 0;
    let loggedSample = false;

    try {
      for (let page = 1; page <= this.maxPages; page++) {
        const entries = await this.fetchPage(apiKey, setExternalId, page);
        if (entries.length === 0) break;
        fetchedRaw += entries.length;

        // Observabilidad (§4.15b): LOG UN ejemplo de la 1ª entrada cruda para verificar el
        // esquema real en Railway. NO contiene secretos (solo datos de precio de una carta).
        if (!loggedSample) {
          loggedSample = true;
          this.logger.log(
            `PokemonPriceTracker bulk: ejemplo de entrada cruda (set ${setExternalId}): ` +
              JSON.stringify(entries[0]).slice(0, 1000),
          );
        }

        for (const entry of entries) {
          const { added, dropped } = this.mapEntry(entry, setExternalId);
          rows.push(...added);
          skipped += dropped;
        }
        // Última página si vino incompleta (SUPUESTO de paginación; verificar 1ª corrida).
        if (entries.length < this.pageLimit) break;
      }
    } catch (e) {
      // Money-safe: ante fallo/timeout/429 NO borramos precios; devolvemos lo acumulado + log.
      this.logger.warn(
        `PokemonPriceTracker bulk: set ${setExternalId} falló: ${(e as Error).message}. ` +
          `Se devuelven ${rows.length} filas (precios previos quedan STALE, no se borran).`,
      );
    }
    return { rows, fetchedRaw, skipped };
  }

  /** POST bulk-price de UNA página. Devuelve el array de entradas crudas (defensivo con el shape). */
  private async fetchPage(apiKey: string, setExternalId: string, page: number): Promise<unknown[]> {
    const res = await fetch(`${this.baseUrl}/cards/bulk-price`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      // SUPUESTO (verificar 1ª corrida): el endpoint acepta `set` (externalId) + `limit` + `page`.
      body: JSON.stringify({ set: setExternalId, limit: this.pageLimit, page }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const body: unknown = await res.json();
    return this.extractEntries(body);
  }

  /**
   * Extrae el array de entradas del cuerpo (defensivo con el envelope, SUPUESTO a verificar):
   * soporta `{ data: [] }`, `{ cards: [] }`, `{ results: [] }` o un array pelón.
   */
  private extractEntries(body: unknown): unknown[] {
    if (Array.isArray(body)) return body;
    if (body && typeof body === 'object') {
      const o = body as Record<string, unknown>;
      for (const key of ['data', 'cards', 'results', 'prices']) {
        if (Array.isArray(o[key])) return o[key] as unknown[];
      }
    }
    return [];
  }

  /**
   * Mapea UNA entrada cruda → filas por (carta, acabado). Money-safe: valida y OMITE lo mal formado.
   * Maneja los dos shapes probables (SUPUESTO, verificar 1ª corrida):
   *  (A) tcgplayer-like: `entry.prices = { <variante>: { market } | <número> }`.
   *  (B) plano: `entry.{variant|finish|printing}` + `entry.{market|marketPrice|price}`.
   */
  private mapEntry(
    entry: unknown,
    setExternalId: string,
  ): { added: BulkPriceRow[]; dropped: number } {
    const added: BulkPriceRow[] = [];
    let dropped = 0;
    if (!entry || typeof entry !== 'object') return { added, dropped: 1 };
    const e = entry as Record<string, unknown>;

    // Identificadores de la carta (SUPUESTO de nombres; se OMITE si no hay ninguno resoluble).
    const externalId = firstString(e, ['id', 'cardId', 'productId', '_id']);
    const number = firstString(e, ['number', 'cardNumber', 'collectorNumber']);
    // moneda de ORIGEN (SUPUESTO: ausente ⇒ USD, proveedor de mercado US). Se verifica 1ª corrida.
    const currency = readCurrency(e['currency']);

    const pricesObj = e['prices'];
    if (pricesObj && typeof pricesObj === 'object' && !Array.isArray(pricesObj)) {
      // Shape (A): mapa variante → { market } | número.
      for (const [rawVariant, val] of Object.entries(pricesObj as Record<string, unknown>)) {
        const finish = normalizeFinishAlias(rawVariant);
        const marketCents = readMarketCents(val);
        if (finish == null || marketCents == null) {
          dropped += 1;
          continue;
        }
        added.push({ externalId, setExternalId, number, finish, marketCents, currency });
      }
      return { added, dropped };
    }

    // Shape (B): variante + market planos en la entrada.
    const finish = normalizeFinishAlias(
      firstString(e, ['variant', 'finish', 'printing', 'condition']),
    );
    const marketCents = readMarketCents(
      e['market'] ?? e['marketPrice'] ?? e['price'] ?? e['marketCents'],
    );
    if (finish == null || marketCents == null) {
      // Variante desconocida o sin market válido → OMITE (money-safe: no atribuye a `normal`).
      return { added, dropped: 1 };
    }
    added.push({ externalId, setExternalId, number, finish, marketCents, currency });
    return { added, dropped };
  }
}

/** Devuelve el primer valor string no vacío entre `keys`, o null. */
function firstString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** USD/MXN respetando el payload; ausente/ambiguo ⇒ USD (SUPUESTO, §4.15d). */
function readCurrency(v: unknown): 'USD' | 'MXN' {
  if (typeof v === 'string' && v.toUpperCase() === 'MXN') return 'MXN';
  return 'USD';
}

/**
 * Lee el market y lo devuelve en CENTAVOS enteros (>0), o null si es inválido.
 * SUPUESTO CRÍTICO (verificar 1ª corrida): `market` viene en DÓLARES (float, ej. 12.34), como
 * TCGPlayer → se multiplica ×100. Si en realidad viniera en centavos, este ×100 INFLARÍA 100× →
 * por eso el flip del dial al proveedor de paga se GATEA con la verificación de esquema (§4.15h).
 */
function readMarketCents(v: unknown): number | null {
  let dollars: number | null = null;
  if (typeof v === 'number') dollars = v;
  else if (v && typeof v === 'object') {
    const m = (v as Record<string, unknown>)['market'];
    if (typeof m === 'number') dollars = m;
  }
  if (dollars == null || !Number.isFinite(dollars) || dollars <= 0) return null;
  const cents = Math.round(dollars * 100);
  return cents > 0 ? cents : null;
}
