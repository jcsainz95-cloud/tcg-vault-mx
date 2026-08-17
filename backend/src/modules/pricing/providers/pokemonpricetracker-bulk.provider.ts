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
 * Formato de precio del proveedor de paga = **moneda + unidad**, FIJADO EXPLÍCITAMENTE por el
 * operador (env `POKEMONPRICETRACKER_MARKET_FORMAT`). NO hay default: el candado fail-closed exige
 * una acción consciente antes de persistir dinero (WS-A seguridad Media + qa IMPORTANTE).
 *
 * PO CONFIRMÓ (2026-08-17): PokemonPriceTracker devuelve `market` en **USD dólares** (unidades) →
 * el operador debe fijar `POKEMONPRICETRACKER_MARKET_FORMAT=usd_dollars` tras ver el log de la 1ª
 * corrida. Aun así NO lo sembramos como default en código: el flip requiere fijar la env a mano.
 */
type MarketFormat = { currency: 'USD' | 'MXN'; unit: 'dollars' | 'cents' };
const MARKET_FORMATS: Record<string, MarketFormat> = {
  usd_dollars: { currency: 'USD', unit: 'dollars' }, // ← confirmado PO (×100 + FX + colchón, = legacy)
  usd_cents: { currency: 'USD', unit: 'cents' }, //     (sin ×100; + FX + colchón)
  mxn_dollars: { currency: 'MXN', unit: 'dollars' }, //  (×100; SIN conversión FX)
  mxn_cents: { currency: 'MXN', unit: 'cents' }, //      (sin ×100; SIN conversión FX)
};

function parseMarketFormat(raw: unknown): MarketFormat | null {
  if (typeof raw !== 'string') return null;
  return MARKET_FORMATS[raw.trim().toLowerCase()] ?? null;
}

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
 * FAIL-CLOSED de moneda/unidad (WS-A, seguridad Media + qa): el proveedor de paga **NO persiste
 * precios bajo una moneda/unidad ASUMIDA**. El formato lo fija el operador con
 * `POKEMONPRICETRACKER_MARKET_FORMAT` (sin default):
 *  - **Sin formato** → modo **sample-only**: hace el fetch, LOGUEA la muestra cruda (sin key/headers)
 *    y persiste **NADA** (`rows: []`). Así el flip es seguro aunque el humano olvide el runbook.
 *  - **Con formato** → mapea EXACTO: `usd`→ el ingest aplica FX+colchón; `mxn`→ sin conversión;
 *    `*_dollars`→ ×100; `*_cents`→ sin ×100. La moneda de la fila viene del FORMATO (no del payload).
 *
 * MONEY-SAFE (§4.15d): valida `market > 0`, mapea variante→`Finish` (desconocida → OMITE, jamás la
 * atribuye a `normal`), resuelve la carta aguas abajo (PriceIngestService). Sin key / HTTP fail →
 * `{ rows: [] }` + log (precios STALE, no se borran).
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

    // FAIL-CLOSED: sin formato explícito, el proveedor NO persiste nada (solo muestra el esquema).
    const format = parseMarketFormat(this.config.get<string>('POKEMONPRICETRACKER_MARKET_FORMAT'));

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

        if (!format) {
          // Sample-only: se logueó la muestra; NO se persiste ni una fila (fail-closed money-safe).
          // Una sola página basta para inspeccionar el esquema y NO quema cuota del proveedor.
          this.logger.warn(
            'PokemonPriceTracker bulk: POKEMONPRICETRACKER_MARKET_FORMAT no configurado → modo ' +
              'SAMPLE-ONLY: se logueó la muestra pero NO se persiste ningún precio. Fija el formato ' +
              '(PO confirmó usd_dollars) tras inspeccionar el log.',
          );
          skipped += entries.length;
          break;
        }

        for (const entry of entries) {
          const { added, dropped } = this.mapEntry(entry, setExternalId, format);
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
   * Mapea UNA entrada cruda → filas por (carta, acabado), con la MONEDA y UNIDAD del `format`
   * confirmado por el operador (no del payload). Money-safe: valida y OMITE lo mal formado.
   * Maneja los dos shapes probables (SUPUESTO, verificar 1ª corrida):
   *  (A) tcgplayer-like: `entry.prices = { <variante>: { market } | <número> }`.
   *  (B) plano: `entry.{variant|finish|printing}` + `entry.{market|marketPrice|price}`.
   */
  private mapEntry(
    entry: unknown,
    setExternalId: string,
    format: MarketFormat,
  ): { added: BulkPriceRow[]; dropped: number } {
    const added: BulkPriceRow[] = [];
    let dropped = 0;
    if (!entry || typeof entry !== 'object') return { added, dropped: 1 };
    const e = entry as Record<string, unknown>;

    // Identificadores de la carta (SUPUESTO de nombres; se OMITE si no hay ninguno resoluble).
    const externalId = firstString(e, ['id', 'cardId', 'productId', '_id']);
    const number = firstString(e, ['number', 'cardNumber', 'collectorNumber']);

    const pricesObj = e['prices'];
    if (pricesObj && typeof pricesObj === 'object' && !Array.isArray(pricesObj)) {
      // Shape (A): mapa variante → { market } | número.
      for (const [rawVariant, val] of Object.entries(pricesObj as Record<string, unknown>)) {
        const finish = normalizeFinishAlias(rawVariant);
        const marketCents = toCents(extractMarketNumber(val), format.unit);
        if (finish == null || marketCents == null) {
          dropped += 1;
          continue;
        }
        added.push({ externalId, setExternalId, number, finish, marketCents, currency: format.currency });
      }
      return { added, dropped };
    }

    // Shape (B): variante + market planos en la entrada.
    const finish = normalizeFinishAlias(
      firstString(e, ['variant', 'finish', 'printing', 'condition']),
    );
    const marketCents = toCents(
      extractMarketNumber(e['market'] ?? e['marketPrice'] ?? e['price'] ?? e['marketCents']),
      format.unit,
    );
    if (finish == null || marketCents == null) {
      // Variante desconocida o sin market válido → OMITE (money-safe: no atribuye a `normal`).
      return { added, dropped: 1 };
    }
    added.push({ externalId, setExternalId, number, finish, marketCents, currency: format.currency });
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

/** Extrae el número de market crudo (de un número o de `{ market }`), sin decidir la unidad. */
function extractMarketNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v === 'object') {
    const m = (v as Record<string, unknown>)['market'];
    if (typeof m === 'number' && Number.isFinite(m)) return m;
  }
  return null;
}

/**
 * Convierte el market crudo a CENTAVOS enteros (>0) según la UNIDAD confirmada por el operador:
 *  - `dollars` → ×100 (float en unidades monetarias → centavos), como el legacy USD/TCGPlayer.
 *  - `cents`   → sin ×100 (el payload YA da centavos), solo redondea.
 * Devuelve null si el market es inválido (ausente/≤0/NaN) → la fila se OMITE (money-safe).
 */
function toCents(raw: number | null, unit: 'dollars' | 'cents'): number | null {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  const cents = unit === 'cents' ? Math.round(raw) : Math.round(raw * 100);
  return cents > 0 ? cents : null;
}
