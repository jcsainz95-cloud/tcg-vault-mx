import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Finish, PriceSource } from '@prisma/client';
import {
  BulkFetchInput,
  BulkPriceProvider,
  BulkPriceResult,
  BulkPriceRow,
  FreshCardPriceProvider,
  FreshCardPriceResult,
  FreshCardPriceRow,
  FreshCardRef,
  normalizeFinishAlias,
  normalizeVerifiedFinishAlias,
} from '../pricing.types';
import { PptApiClient, PptDailyLimitError, PptHttpError, PptResponse } from './ppt-api.client';

/**
 * Formato de precio del proveedor de paga = **moneda + unidad**, FIJADO EXPLÍCITAMENTE por el
 * operador (env `POKEMONPRICETRACKER_MARKET_FORMAT`). NO hay default: el candado fail-closed exige
 * una acción consciente antes de persistir dinero (WS-A seguridad Media + qa IMPORTANTE).
 *
 * PO CONFIRMÓ (2026-08-17): PokemonPriceTracker devuelve el `market` en **USD dólares** (unidades)
 * → el operador debe fijar `POKEMONPRICETRACKER_MARKET_FORMAT=usd_dollars` tras ver el log de la 1ª
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
 * Impresiones que se piden por separado en modo `fetchPrintings` (WS-A fix-ppt causa #4). Cada una es
 * un barrido `/cards?setId=X&printing=<label>&fetchAllInSet=true`. El label es el que espera la API; el
 * finish, nuestro enum.
 *
 * ⚠️ CONFIRMADO 2026-08-23 (BUG DE DINERO): la API v2 NO devuelve un `market` DISTINTO por impresión —
 * `prices.market` es SIEMPRE el de la impresión primaria de la carta (`prices.primaryPrinting`),
 * invariante al `?printing=`. Por eso el market de una pasada NO se atribuye a la etiqueta barrida
 * (aplanaría normal=reverse_holo=holofoil): solo se acredita a la carta cuya `primaryPrinting` REAL
 * casa con la etiqueta (ver `mapEntry` rama `forced`). El precio por-acabado de reverse/holo lo provee
 * la fuente por-acabado (TCGCSV `tcgcsv_singles`), no este barrido.
 */
const PRINTINGS: ReadonlyArray<{ label: string; finish: Finish }> = [
  { label: 'Normal', finish: 'normal' },
  { label: 'Reverse Holofoil', finish: 'reverse_holo' },
  { label: 'Holofoil', finish: 'holofoil' },
];

/**
 * Paginación normalizada del envelope v2 del proveedor. En la API v2 los campos vienen al NIVEL
 * RAÍZ del cuerpo (`{ data, total, count, limit, offset, hasMore }` o dentro de `metadata`); se
 * tolera también el shape anidado `{ pagination: { … } }`. La paginación es por `offset`.
 */
interface PageInfo {
  total: number | null;
  count: number | null;
  limit: number | null;
  offset: number | null;
  hasMore: boolean | null;
}

interface PricesPage {
  entries: unknown[];
  pagination: PageInfo | null;
  url: string;
  dailyRemaining: number | null;
}

/** Motivos de OMISIÓN del mapeo (diagnóstico: distingue "no mapeó" de "falló el request"). */
interface DropCounts {
  notObject: number;
  foreignSet: number;
  noFinish: number;
  noMarket: number;
}

const NO_DROPS: DropCounts = { notObject: 0, foreignSet: 0, noFinish: 0, noMarket: 0 };

/** Motivo por el que un set devolvió 0 filas (observabilidad, causa #5 del incidente). */
type ZeroReason =
  | 'ok'
  | 'setId no mapeado'
  | '429 daily'
  | '429 per_minute'
  | 'request falló'
  | '200 sin datos'
  | 'sample-only';

/**
 * PokemonPriceTrackerBulkProvider — implementación PRIMARIA del `BulkPriceProvider`
 * (WS-A, ARCHITECTURE §4.15b). Barre las cartas de un set con la **API v2** de precios.
 *
 * **WS-A fix-ppt (2026-08-19) — reescritura tras el incidente de producción** (0 precios todo el día,
 * 114× HTTP 429). Cuatro cambios sobre la versión anterior:
 *  1. **setId REAL de PPT** (`input.providerSetId`, cacheado en `CardSet.pptSetId` por `PptSetMapper`)
 *     en vez del `externalId` de pokemontcg.io — CAUSA RAÍZ del "0 entradas". Sin mapeo → NO se pide
 *     nada (se loguea `setId no mapeado`), jamás se cae al `externalId` (repetiría el bug).
 *  2. **Throttle centralizado** en `PptApiClient`: 429 `per_minute` espera Retry-After y reintenta;
 *     429 `daily` PARA (señal `dailyLimited`), sin reintentar hasta 00:00 UTC.
 *  3. **Shape real v2**: la LISTA trae un `prices.{market, primaryPrinting}` por carta (un solo
 *     market + la impresión primaria). Se mapea `market → finish(primaryPrinting)`. Se conservan como
 *     fallback tolerante los shapes previos (`tcgplayer.prices` por acabado, listas de printings).
 *  4. **Variantes por impresión** (opcional, `fetchPrintings`): un barrido por `printing=`. OJO
 *     (2026-08-23): la API v2 NO da market por impresión (siempre el de la primaria) ⇒ este modo SOLO
 *     acredita el acabado que casa con `prices.primaryPrinting`; NO puebla reverse/holo por sí mismo
 *     (esa fuente es TCGCSV `tcgcsv_singles`). Se conserva money-safe: jamás copia el market a otro
 *     acabado. Ver `mapEntry` rama `forced` y BACKEND_NOTES §PPT-por-impresión.
 *
 * SEGURIDAD (sin cambio): host FIJO en `PptApiClient` (anti-SSRF), key solo en el header, jamás en
 * la URL ni el log. FAIL-CLOSED de moneda/unidad (sin `POKEMONPRICETRACKER_MARKET_FORMAT` → sample-only,
 * no persiste nada). MONEY-SAFE: valida `market>0`, acabado desconocido/ausente → OMITE (nunca `normal`),
 * ante 429/timeout NO borra precios.
 */
@Injectable()
export class PokemonPriceTrackerBulkProvider implements BulkPriceProvider, FreshCardPriceProvider {
  readonly source: PriceSource = 'pokemonpricetracker';
  private readonly logger = new Logger(PokemonPriceTrackerBulkProvider.name);
  private readonly cardsPath = '/api/v2/cards';
  /** Tamaño de página al paginar por `offset` (solo si el envelope señala `hasMore`). */
  private readonly pageLimit = 200;
  /** Cota dura de páginas (anti-bucle si la paginación del proveedor no converge). */
  private readonly maxPages = 40;
  /**
   * v1.26 (P-7 ⑤) — cota DURA de cartas por request de fetch fresco (defensa en profundidad; el
   * llamador `refreshCardPrices` ya capa, pero el proveedor NUNCA barre — respeta la cuota diaria).
   */
  private readonly maxFreshCards = 100;

  constructor(
    private readonly config: ConfigService,
    private readonly client: PptApiClient,
  ) {}

  async fetchPricesForSet(input: BulkFetchInput): Promise<BulkPriceResult> {
    const providerSetId = input.providerSetId ?? null;

    // Sin key → NO revienta y NO escribe (precios stale, money-safe). §4.15b/§4.15h.
    if (!this.client.apiKey()) {
      this.logger.warn(
        'PokemonPriceTracker bulk: falta POKEMONPRICETRACKER_API_KEY → no se ingesta ' +
          `(precios STALE, no se borran). Set ${input.set.externalId}.`,
      );
      return { rows: [], fetchedRaw: 0, skipped: 0 };
    }

    // CAUSA RAÍZ #1: sin `pptSetId` NO se pide nada (jamás se cae al externalId, que PPT no reconoce).
    if (!providerSetId) {
      this.logSummary({
        setExternalId: input.set.externalId,
        reason: 'setId no mapeado',
        fetchedRaw: 0,
        mapped: 0,
        drops: { ...NO_DROPS },
        sample: null,
      });
      return { rows: [], fetchedRaw: 0, skipped: 0 };
    }

    // FAIL-CLOSED: sin formato explícito, el proveedor NO persiste nada (solo muestra el esquema).
    const format = parseMarketFormat(this.config.get<string>('POKEMONPRICETRACKER_MARKET_FORMAT'));

    // Modo VARIANTES por impresión (opcional): un barrido por impresión, cada market → ese finish.
    if (input.fetchPrintings && format) {
      return this.fetchByPrintings(input, providerSetId, format);
    }

    return this.fetchSingleSweep(input, providerSetId, format, undefined);
  }

  /**
   * Barrido ÚNICO del set (modo por defecto): una respuesta lista → `prices.{market, primaryPrinting}`
   * por carta. Si `forced` viene (modo por-impresión), el `market` se atribuye ENTERO a `forced.finish`.
   */
  private async fetchSingleSweep(
    input: BulkFetchInput,
    providerSetId: string,
    format: MarketFormat | null,
    forced: { label: string; finish: Finish } | undefined,
  ): Promise<BulkPriceResult> {
    const setExternalId = input.set.externalId;
    const rows: BulkPriceRow[] = [];
    const drops: DropCounts = { ...NO_DROPS };
    let fetchedRaw = 0;
    let skipped = 0;
    let sample: string | null = null;
    let requestOk = false;
    let dailyLimited = false;
    let reason: ZeroReason = 'ok';

    try {
      let received = 0;
      let offset: number | null = null; // null = 1er request (sin offset/limit)
      for (let page = 0; page < this.maxPages; page++) {
        const { entries, pagination, url, dailyRemaining } = await this.fetchPricesPage(
          providerSetId,
          offset,
          input.minPrice ?? null,
          forced?.label ?? null,
        );
        requestOk = true;
        if (entries.length === 0) {
          if (page === 0) reason = '200 sin datos';
          break;
        }
        received += entries.length;
        fetchedRaw += entries.length;

        if (sample == null) {
          sample = truncate(JSON.stringify(entries[0]), 800);
          this.logger.log(
            `PokemonPriceTracker bulk: GET ${url} OK (set ${setExternalId}=${providerSetId}` +
              `${forced ? `, printing=${forced.label}` : ''}, pág ${page + 1}): ${entries.length} entradas, ` +
              `pagination=${JSON.stringify(pagination)}, dailyRemaining=${dailyRemaining ?? 'n/d'}. ` +
              `Ejemplo crudo: ${sample}`,
          );
        }

        if (!format) {
          this.logger.warn(
            'PokemonPriceTracker bulk: POKEMONPRICETRACKER_MARKET_FORMAT no configurado → modo ' +
              'SAMPLE-ONLY: se logueó la muestra pero NO se persiste ningún precio. Fija el formato ' +
              '(PO confirmó usd_dollars) tras inspeccionar el log.',
          );
          skipped += entries.length;
          reason = 'sample-only';
          break;
        }

        for (const entry of entries) {
          const mapped = this.mapEntry(entry, providerSetId, format, forced);
          rows.push(...mapped.added);
          addDrops(drops, mapped.drops);
        }

        if (!this.hasMorePages(pagination, received)) break;
        offset = received;
      }
    } catch (e) {
      if (e instanceof PptDailyLimitError) {
        dailyLimited = true;
        reason = '429 daily';
        this.logger.warn(
          `PokemonPriceTracker bulk: 429 DAILY en el set ${setExternalId} → PARADA. ${e.message}. ` +
            `Se devuelven ${rows.length} filas (precios previos STALE, no se borran).`,
        );
      } else {
        reason = e instanceof PptHttpError && e.status === 429 ? '429 per_minute' : 'request falló';
        this.logger.warn(
          `PokemonPriceTracker bulk: EL REQUEST FALLÓ para el set ${setExternalId}: ${(e as Error).message}. ` +
            `Se devuelven ${rows.length} filas (precios previos STALE, no se borran).`,
        );
      }
    }

    skipped += drops.notObject + drops.foreignSet + drops.noFinish + drops.noMarket;
    this.logSummary({ setExternalId, reason, fetchedRaw, mapped: rows.length, drops, sample });
    // `requestOk` = alguna página respondió OK (incluye sample-only, que devuelve rows:[] → el gate
    // `requestOk && rows>0` del ingest igual lo excluye de tocar snapshots).
    return { rows, fetchedRaw, skipped, requestOk, dailyLimited, dailyRemaining: this.client.dailyRemaining() };
  }

  /**
   * Modo VARIANTES: barre el set una vez por cada impresión de `PRINTINGS` y une las filas. Cada
   * barrido atribuye su `market` al `finish` de esa impresión, así se pueblan las 2 casillas por
   * carta (normal + reverse holo) que hoy quedan vacías. Costo ≈ nº impresiones × por set.
   * Money-safe: si una impresión topa el límite diario, se corta y se devuelve lo acumulado.
   */
  private async fetchByPrintings(
    input: BulkFetchInput,
    providerSetId: string,
    format: MarketFormat,
  ): Promise<BulkPriceResult> {
    const rows: BulkPriceRow[] = [];
    let fetchedRaw = 0;
    let skipped = 0;
    let requestOk = false;
    let dailyLimited = false;

    for (const printing of PRINTINGS) {
      const res = await this.fetchSingleSweep(input, providerSetId, format, printing);
      rows.push(...res.rows);
      fetchedRaw += res.fetchedRaw;
      skipped += res.skipped;
      requestOk = requestOk || Boolean(res.requestOk);
      if (res.dailyLimited) {
        dailyLimited = true;
        break; // cuota diaria agotada → no seguir con más impresiones.
      }
    }
    this.logger.log(
      `PokemonPriceTracker bulk (por impresión): set ${input.set.externalId}=${providerSetId} → ` +
        `${rows.length} filas de ${PRINTINGS.length} impresiones, ${fetchedRaw} crudas.`,
    );
    return { rows, fetchedRaw, skipped, requestOk, dailyLimited, dailyRemaining: this.client.dailyRemaining() };
  }

  /**
   * v1.26 (P-7 ⑤, §4.24e) — fetch FRESCO puntual por carta (PRIMARIO). Keyeado por `Card.tcgplayerId`
   * (poblado en ①), UNA petición por carta a `GET /api/v2/cards?tcgplayerId=<id>` (JAMÁS un barrido).
   *
   * CUOTA DIARIA (money-safe): si el cliente ya está `dailyLimited` o topa un 429 daily, PARA de
   * inmediato (`dailyLimited=true`) y devuelve lo acumulado — el resto de cartas se queda pending (el
   * llamador cae a la referencia ALMACENADA). FAIL-CLOSED de formato: sin `POKEMONPRICETRACKER_MARKET_FORMAT`
   * NO persiste nada (sample-only). Una carta sin `tcgplayerId`, sin market válido, o un fallo de red →
   * NO produce fila (nunca inventa un precio). Cota dura `maxFreshCards` (nunca barre).
   */
  async fetchFreshForCards(cards: FreshCardRef[]): Promise<FreshCardPriceResult> {
    if (!this.client.apiKey()) {
      this.logger.warn('PPT fresh: falta POKEMONPRICETRACKER_API_KEY → no se repricea (ref STALE).');
      return { rows: [], requestOk: false, dailyLimited: false };
    }
    const format = parseMarketFormat(this.config.get<string>('POKEMONPRICETRACKER_MARKET_FORMAT'));
    if (!format) {
      this.logger.warn('PPT fresh: POKEMONPRICETRACKER_MARKET_FORMAT no configurado → NO se persiste.');
      return { rows: [], requestOk: false, dailyLimited: false };
    }

    const rows: FreshCardPriceRow[] = [];
    let requestOk = false;
    let dailyLimited = false;
    const capped = cards.slice(0, this.maxFreshCards);
    for (const card of capped) {
      if (!card.tcgplayerId) continue; // sin ancla → el fallback (pokemontcg.io) la intentará.
      if (this.client.isDailyLimited()) {
        dailyLimited = true;
        break;
      }
      try {
        const res: PptResponse<unknown> = await this.client.getJson<unknown>(this.cardsPath, {
          tcgplayerId: card.tcgplayerId,
        });
        requestOk = true;
        const entries = this.extractEntries(res.body);
        const wanted = new Set<Finish>(card.finishes);
        for (const entry of entries) {
          for (const { finish, marketCents } of this.mapFreshEntry(entry, format)) {
            if (wanted.has(finish)) {
              rows.push({ cardId: card.cardId, finish, marketCents, currency: format.currency, source: 'pokemonpricetracker' });
            }
          }
        }
      } catch (e) {
        if (e instanceof PptDailyLimitError) {
          dailyLimited = true;
          this.logger.warn(`PPT fresh: 429 DAILY en tcgplayerId=${card.tcgplayerId} → PARADA. ${e.message}`);
          break;
        }
        this.logger.warn(
          `PPT fresh: falló tcgplayerId=${card.tcgplayerId}: ${(e as Error).message} (ref previa STALE, no se borra).`,
        );
      }
    }
    return { rows, requestOk, dailyLimited };
  }

  /**
   * v1.26 (P-7 ⑤) — mapea UNA entrada cruda del lookup por `tcgplayerId` → filas (finish, marketCents),
   * SIN filtro de set (el request ya scopeó a la carta). Cubre el shape real v2 (`prices.{market,
   * primaryPrinting}`) y el fallback per-acabado (`tcgplayer.prices = { <finishKey>:{market} }`).
   * Money-safe: acabado desconocido/market<=0 → OMITE (nunca `normal`, nunca 0).
   */
  private mapFreshEntry(entry: unknown, format: MarketFormat): { finish: Finish; marketCents: number }[] {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const e = entry as Record<string, unknown>;
    const out: { finish: Finish; marketCents: number }[] = [];
    const add = (rawFinish: unknown, rawMarket: unknown): void => {
      const finish = normalizeFinishAlias(rawFinish);
      if (finish == null) return;
      const marketCents = toCents(extractMarketNumber(rawMarket), format.unit);
      if (marketCents == null) return;
      out.push({ finish, marketCents });
    };
    // (1) real v2: `prices = { market, primaryPrinting }`.
    const prices = e['prices'];
    if (prices && typeof prices === 'object' && !Array.isArray(prices)) {
      const pr = prices as Record<string, unknown>;
      if (typeof pr['market'] === 'number' || typeof pr['marketPrice'] === 'number') {
        add(pr['primaryPrinting'], pr);
        return out;
      }
    }
    // (2) fallback mirror pokemontcg.io: `tcgplayer.prices = { <finishKey>:{market} }`.
    const tcgplayer = e['tcgplayer'];
    if (tcgplayer && typeof tcgplayer === 'object' && !Array.isArray(tcgplayer)) {
      const tp = (tcgplayer as Record<string, unknown>)['prices'];
      if (tp && typeof tp === 'object' && !Array.isArray(tp)) {
        for (const [finishKey, priceObj] of Object.entries(tp as Record<string, unknown>)) add(finishKey, priceObj);
      }
    }
    return out;
  }

  /**
   * Diagnóstico observable (causa #5): SIEMPRE deja una línea con el MOTIVO cuando el set da 0 filas
   * (`429 daily` / `429 per_minute` / `setId no mapeado` / `200 sin datos` / `sample-only` / mapeo
   * vacío), en vez del genérico "0 entradas" que no decía nada.
   */
  private logSummary(s: {
    setExternalId: string;
    reason: ZeroReason;
    fetchedRaw: number;
    mapped: number;
    drops: DropCounts;
    sample: string | null;
  }): void {
    const breakdown =
      `${s.drops.noFinish} sin acabado, ${s.drops.noMarket} sin market, ` +
      `${s.drops.foreignSet} de otro set, ${s.drops.notObject} no-objeto`;
    const head =
      `PokemonPriceTracker bulk resumen (set ${s.setExternalId}): ${s.fetchedRaw} crudas → ` +
      `${s.mapped} filas [${breakdown}]. motivo=${s.reason}.`;

    if (s.mapped === 0 && s.reason !== 'ok') {
      this.logger.warn(
        `${head}${s.reason === 'setId no mapeado' ? ' (empata el set en GET /api/v2/sets)' : ''}` +
          `${s.sample ? ` Ejemplo crudo: ${s.sample}` : ''}`,
      );
      return;
    }
    if (s.fetchedRaw > 0 && s.mapped === 0) {
      this.logger.warn(`${head} El request PASÓ pero NADA mapeó → revisa el ejemplo crudo: ${s.sample ?? 'n/d'}`);
      return;
    }
    this.logger.log(head);
  }

  private hasMorePages(pagination: PageInfo | null, received: number): boolean {
    if (!pagination) return false;
    if (pagination.hasMore === true) return true;
    if (pagination.hasMore === false) return false;
    if (pagination.total != null && pagination.total >= 0) return received < pagination.total;
    return false;
  }

  /**
   * GET de UNA página del barrido (API v2, vía `PptApiClient` con throttle). `offset === null` → 1er
   * request (`setId&fetchAllInSet=true`); `offset` numérico → página siguiente. `minPrice`/`printing`
   * se añaden si vienen. Propaga `PptDailyLimitError`/`PptHttpError` (el llamador es money-safe).
   */
  private async fetchPricesPage(
    providerSetId: string,
    offset: number | null,
    minPrice: string | null,
    printing: string | null,
  ): Promise<PricesPage> {
    const query: Record<string, string> = { setId: providerSetId, fetchAllInSet: 'true' };
    if (offset != null) {
      query.limit = String(this.pageLimit);
      query.offset = String(offset);
    }
    if (minPrice) query.minPrice = minPrice;
    if (printing) query.printing = printing;

    const res: PptResponse<unknown> = await this.client.getJson<unknown>(this.cardsPath, query);
    return {
      entries: this.extractEntries(res.body),
      pagination: this.extractPagination(res.body),
      url: res.url,
      dailyRemaining: res.dailyRemaining,
    };
  }

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

  private extractPagination(body: unknown): PageInfo | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const root = body as Record<string, unknown>;
    // v2 real: los contadores viven en `metadata`; se tolera `pagination` y el nivel raíz.
    const meta = root['metadata'];
    const nested = root['pagination'];
    const p =
      meta && typeof meta === 'object' && !Array.isArray(meta)
        ? (meta as Record<string, unknown>)
        : nested && typeof nested === 'object' && !Array.isArray(nested)
          ? (nested as Record<string, unknown>)
          : root;
    return {
      total: numberOrNull(p['total'] ?? p['totalCount']),
      count: numberOrNull(p['count']),
      limit: numberOrNull(p['limit'] ?? p['pageSize'] ?? p['perPage']),
      offset: numberOrNull(p['offset']),
      hasMore: typeof p['hasMore'] === 'boolean' ? (p['hasMore'] as boolean) : boolOrNull(p['hasNextPage']),
    };
  }

  /**
   * Mapea UNA entrada cruda → filas por (carta, acabado), con la MONEDA/UNIDAD de `format`. Money-safe:
   * valida y OMITE lo mal formado contando el MOTIVO. Fuentes, en orden:
   *  0. `forced` (modo por-impresión): `market` de nivel carta → `forced.finish`.
   *  1. **REAL v2 lista**: `entry.prices = { market, primaryPrinting, low, lastUpdated }` (un market +
   *     la impresión primaria) → `market → finish(primaryPrinting)`.
   *  2. FALLBACK `entry.tcgplayer.prices = { <finishKey>: { market } }` (mirror pokemontcg.io).
   *  3. FALLBACK colecciones `entry.prices|printings|variants = [ { printing, marketPrice }, … ]` o
   *     `entry.prices = { <printing>: { marketPrice } }`, y PLANO `entry.printing`+`entry.marketPrice`.
   */
  private mapEntry(
    entry: unknown,
    providerSetId: string,
    format: MarketFormat,
    forced: { label: string; finish: Finish } | undefined,
  ): { added: BulkPriceRow[]; drops: Partial<DropCounts> } {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { added: [], drops: { notObject: 1 } };
    }
    const e = entry as Record<string, unknown>;

    // Descarta cartas de OTRO set si el payload trae un setId por carta que no casa (defensivo; la
    // API v2 suele traer `setName`, no `setId`, así que normalmente no aplica — el request ya scopeó).
    const entrySetId = firstString(e, ['setId', 'set', 'setCode']);
    if (entrySetId && entrySetId.toLowerCase() !== providerSetId.toLowerCase()) {
      return { added: [], drops: { foreignSet: 1 } };
    }

    // Identificadores para la resolución carta↔BD (ingest): `id`/`cardId` (pokemontcg.io style, si
    // viniera) y `cardNumber` (para el fallback (set, number)).
    const externalId = firstString(e, ['id', 'cardId']);
    const number = firstString(e, ['cardNumber', 'number', 'collectorNumber']);

    const added: BulkPriceRow[] = [];
    const drops: DropCounts = { ...NO_DROPS };
    const push = (rawFinish: unknown, rawMarket: unknown, opts: { forcedPrinting?: boolean } = {}): void => {
      const finish = normalizeFinishAlias(rawFinish);
      if (finish == null) {
        drops.noFinish += 1;
        return;
      }
      const marketCents = toCents(extractMarketNumber(rawMarket), format.unit);
      if (marketCents == null) {
        drops.noMarket += 1;
        return;
      }
      // v1.27 (P-13.2, §4.25a-2): en el modo FORZADO el finish viene de la ETIQUETA del request, no
      // de dato de la carta ⇒ NO puede auto-verificarse como alias (antes `finishAliasVerified` se
      // computaba sobre la propia etiqueta y siempre daba true). La fila sirve para PRECIOS, jamás
      // como evidencia estructural (`forcedPrinting: true` → el ingest la excluye del snapshot).
      const forcedPrinting = opts.forcedPrinting === true;
      const finishAliasVerified = !forcedPrinting && normalizeVerifiedFinishAlias(rawFinish) !== null;
      added.push({
        externalId,
        setExternalId: providerSetId,
        number,
        finish,
        marketCents,
        currency: format.currency,
        finishAliasVerified,
        ...(forcedPrinting ? { forcedPrinting } : {}),
      });
    };

    // (0) Modo por-impresión (`fetchPrintings`). BUG DE DINERO CONFIRMADO 2026-08-23: la API v2 de PPT
    // NO varía `prices.market` según `?printing=` — CADA pasada devuelve el MISMO market, el de la
    // impresión PRIMARIA de la carta (`prices.primaryPrinting`). La versión anterior atribuía ese market
    // a la ETIQUETA del request (`forced.label`), así que las 3 pasadas (Normal/Reverse Holofoil/Holofoil)
    // escribían el MISMO precio a `normal`=`reverse_holo`=`holofoil` (aplanamiento del mercado).
    //
    // MONEY-SAFE (fix): el market SIEMPRE pertenece a `primaryPrinting`, así que solo se emite fila cuando
    // la impresión primaria REAL de la carta coincide con la etiqueta barrida — ese es el ÚNICO acabado
    // cuyo precio PPT realmente conoce. Los demás acabados quedan SIN fila (pendiente/«—»), JAMÁS con el
    // precio de otra impresión. El precio PROPIO de reverse/holo lo provee la fuente por-acabado
    // (TCGCSV `tcgcsv_singles`, precedencia §4.27f). Sin `primaryPrinting` legible ⇒ no se emite nada
    // (nunca se copia un market a un acabado no confirmado).
    if (forced) {
      const primary = extractPrimaryPrinting(e['prices']);
      if (primary != null && normalizeFinishAlias(primary) === forced.finish) {
        push(primary, e['prices'] ?? e['market'] ?? e['marketPrice'] ?? e['price'], {
          forcedPrinting: true,
        });
      }
      return { added, drops };
    }

    // (1) REAL v2 lista: `prices` es un OBJETO con `market` numérico + `primaryPrinting` (string).
    const prices = e['prices'];
    if (prices && typeof prices === 'object' && !Array.isArray(prices)) {
      const pr = prices as Record<string, unknown>;
      if (typeof pr['market'] === 'number' || typeof pr['marketPrice'] === 'number') {
        push(pr['primaryPrinting'], pr);
        return { added, drops };
      }
    }

    // (2) FALLBACK mirror pokemontcg.io: `tcgplayer.prices = { <finishKey>: { market } }`.
    const tcgplayer = e['tcgplayer'];
    if (tcgplayer && typeof tcgplayer === 'object' && !Array.isArray(tcgplayer)) {
      const tp = (tcgplayer as Record<string, unknown>)['prices'];
      if (tp && typeof tp === 'object' && !Array.isArray(tp)) {
        for (const [finishKey, priceObj] of Object.entries(tp as Record<string, unknown>)) {
          push(finishKey, priceObj);
        }
        return { added, drops };
      }
    }

    // (3) FALLBACK colecciones por acabado dentro de la entrada.
    let sawCollection = false;
    for (const key of ['prices', 'printings', 'variants']) {
      const val = e[key];
      if (Array.isArray(val)) {
        sawCollection = true;
        for (const item of val) {
          if (!item || typeof item !== 'object') {
            drops.notObject += 1;
            continue;
          }
          const v = item as Record<string, unknown>;
          push(firstString(v, FINISH_KEYS), v);
        }
      } else if (key === 'prices' && val && typeof val === 'object') {
        sawCollection = true;
        for (const [rawVariant, priceVal] of Object.entries(val as Record<string, unknown>)) {
          push(rawVariant, priceVal);
        }
      }
      if (sawCollection) break;
    }
    if (sawCollection) return { added, drops };

    // (4) PLANO FALLBACK: `printing` + `marketPrice`.
    push(firstString(e, FINISH_KEYS), e['marketPrice'] ?? e['market'] ?? e['price']);
    return { added, drops };
  }
}

const FINISH_KEYS = ['printing', 'variant', 'finish', 'printingName', 'subTypeName', 'primaryPrinting'];

function firstString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * Extrae `primaryPrinting` (string) del objeto `prices` de nivel carta (shape real v2:
 * `{ market, primaryPrinting, … }`), o `null` si no viene legible. Es la impresión a la que PERTENECE
 * el `market` de la carta — el candado money-safe del modo por-impresión (la API v2 no da market por
 * impresión; el market es SIEMPRE el de la primaria).
 */
function extractPrimaryPrinting(prices: unknown): string | null {
  if (prices && typeof prices === 'object' && !Array.isArray(prices)) {
    const v = (prices as Record<string, unknown>)['primaryPrinting'];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

/** Extrae el número de market crudo (de un número o de `{ market|marketPrice|price }`), sin unidad. */
function extractMarketNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['market', 'marketPrice', 'price']) {
      const m = o[k];
      if (typeof m === 'number' && Number.isFinite(m)) return m;
    }
  }
  return null;
}

function toCents(raw: number | null, unit: 'dollars' | 'cents'): number | null {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  const cents = unit === 'cents' ? Math.round(raw) : Math.round(raw * 100);
  return cents > 0 ? cents : null;
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function addDrops(target: DropCounts, add: Partial<DropCounts>): void {
  target.notObject += add.notObject ?? 0;
  target.foreignSet += add.foreignSet ?? 0;
  target.noFinish += add.noFinish ?? 0;
  target.noMarket += add.noMarket ?? 0;
}
