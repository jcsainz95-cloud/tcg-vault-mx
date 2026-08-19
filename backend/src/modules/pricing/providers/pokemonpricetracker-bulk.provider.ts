import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CardSet, PriceSource } from '@prisma/client';
import {
  BulkPriceProvider,
  BulkPriceResult,
  BulkPriceRow,
  normalizeFinishAlias,
  normalizeVerifiedFinishAlias,
} from '../pricing.types';

/**
 * Formato de precio del proveedor de paga = **moneda + unidad**, FIJADO EXPLÍCITAMENTE por el
 * operador (env `POKEMONPRICETRACKER_MARKET_FORMAT`). NO hay default: el candado fail-closed exige
 * una acción consciente antes de persistir dinero (WS-A seguridad Media + qa IMPORTANTE).
 *
 * PO CONFIRMÓ (2026-08-17): PokemonPriceTracker devuelve `marketPrice` en **USD dólares** (unidades)
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

/** Paginación normalizada del envelope del proveedor (`{ data, pagination }`). */
interface PageInfo {
  total: number | null;
  page: number | null;
  /** Tamaño de página EFECTIVO que aplicó el servidor (puede ser < al pedido si capa el `limit`). */
  limit: number | null;
  totalPages: number | null;
  hasMore: boolean | null;
}

/** Una página cruda del barrido por set. */
interface PricesPage {
  entries: unknown[];
  pagination: PageInfo | null;
  /** Ruta que respondió OK (observabilidad: queda en el log de la 1ª corrida). */
  path: string;
}

/** Motivos de OMISIÓN del mapeo (diagnóstico: distingue "no mapeó" de "falló el request"). */
interface DropCounts {
  /** Entrada que no es un objeto mapeable. */
  notObject: number;
  /** El proveedor devolvió una carta de OTRO set (el filtro `setId` no se respetó). */
  foreignSet: number;
  /** Hay precio pero el acabado (`printing`) es desconocido o falta → NUNCA se atribuye a `normal`. */
  noFinish: number;
  /** El acabado es válido pero el market es inválido (ausente/NaN/<=0). */
  noMarket: number;
}

const NO_DROPS: DropCounts = { notObject: 0, foreignSet: 0, noFinish: 0, noMarket: 0 };

/** Error HTTP del proveedor con el CUERPO recortado (para distinguir 4xx de contrato de un 5xx). */
class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly bodySnippet: string,
    readonly path: string,
  ) {
    super(`HTTP ${status} en ${path}${bodySnippet ? ` — cuerpo: ${bodySnippet}` : ''}`);
    this.name = 'ProviderHttpError';
  }
}

/**
 * PokemonPriceTrackerBulkProvider — implementación PRIMARIA del `BulkPriceProvider`
 * (WS-A, ARCHITECTURE §4.15b). Barre TODAS las cartas de un set con el endpoint de PRECIOS:
 *
 *   GET https://www.pokemonpricetracker.com/api/prices?setId=<CardSet.externalId>&limit=&page=
 *   Authorization: Bearer <POKEMONPRICETRACKER_API_KEY>
 *   → { data: [ { id, setId, cardNumber, printing, marketPrice, lowPrice, … } ],
 *       pagination: { total, page, limit } }
 *
 * **P-6 (2026-08-18, DEVOPS_NOTES §23.9):** la versión anterior hacía
 * `POST /api/v1/cards/bulk-price` con cuerpo `{ set, limit, page }`. Ese endpoint SÍ existe, pero
 * su cuerpo documentado es una **lista explícita** `{ cardIds: ["base1-4", …] }` — no acepta un
 * filtro por set. El proveedor respondía 4xx, el `catch` money-safe devolvía 0 filas sin borrar
 * nada, y el catálogo se quedaba sin ninguna referencia de mercado. El barrido por set es este
 * otro endpoint. El modo por-lista NO se implementa: no hay ningún flujo que lo necesite (el
 * ingest siempre trabaja set por set) y construir los `cardIds` desde la BD sería más requests y
 * más frágil para el mismo resultado.
 *
 * RUTA NO VERIFICADA EN RUNTIME: el egress del sandbox de desarrollo bloquea el dominio del
 * proveedor, así que la fuente es su documentación pública. La doc alterna entre `/api/prices` y
 * `/api/v1/prices` según la página → se prueban AMBAS en orden en el primer request y se recuerda
 * la que respondió (`resolvedPath`), dejando en el log cuál fue. Un 404/400 de la primera NO
 * aborta la corrida.
 *
 * SEGURIDAD:
 *  - **Host FIJO** (`www.pokemonpricetracker.com`, sin parte controlable) → sin SSRF (patrón
 *    `PokemonTcgIoClient`). El cliente NUNCA acepta URLs arbitrarias. El único valor interpolado
 *    es `CardSet.externalId`, y va URL-encoded como query param.
 *  - La API key se lee SOLO de `process.env.POKEMONPRICETRACKER_API_KEY` (vía ConfigService).
 *    NUNCA se hardcodea, se loguea ni se commitea (repo público). Los logs de diagnóstico jamás
 *    incluyen headers ni la URL con credenciales.
 *
 * FAIL-CLOSED de moneda/unidad (WS-A, seguridad Media + qa): el proveedor de paga **NO persiste
 * precios bajo una moneda/unidad ASUMIDA**. El formato lo fija el operador con
 * `POKEMONPRICETRACKER_MARKET_FORMAT` (sin default):
 *  - **Sin formato** → modo **sample-only**: hace el fetch, LOGUEA la muestra cruda (sin key/headers)
 *    y persiste **NADA** (`rows: []`). Así el flip es seguro aunque el humano olvide el runbook.
 *  - **Con formato** → mapea EXACTO: `usd`→ el ingest aplica FX+colchón; `mxn`→ sin conversión;
 *    `*_dollars`→ ×100; `*_cents`→ sin ×100. La moneda de la fila viene del FORMATO (no del payload).
 *
 * MONEY-SAFE (§4.15d): valida `marketPrice > 0`, mapea `printing`→`Finish` (desconocida o AUSENTE →
 * OMITE, jamás la atribuye a `normal`), descarta cartas de otro set, y resuelve la carta aguas
 * abajo (PriceIngestService). Sin key / HTTP fail → `{ rows: [] }` + log (precios STALE, no se borran).
 */
@Injectable()
export class PokemonPriceTrackerBulkProvider implements BulkPriceProvider {
  readonly source: PriceSource = 'pokemonpricetracker';
  private readonly logger = new Logger(PokemonPriceTrackerBulkProvider.name);
  /** Host FIJO — no configurable por el usuario (anti-SSRF). */
  private readonly host = 'https://www.pokemonpricetracker.com';
  /**
   * Rutas candidatas del barrido por set, en orden de preferencia. La doc pública del proveedor
   * alterna entre ambas; se prueban en el primer request y se memoriza la que respondió.
   */
  private readonly pricesPaths = ['/api/prices', '/api/v1/prices'];
  /** Ruta que ya respondió OK en este proceso (evita re-probar candidatas en cada página/set). */
  private resolvedPath: string | null = null;
  /**
   * Tamaño de página PEDIDO. La doc de `/api/prices` documenta hasta 1000 por request (el bulk
   * por-lista es el que menciona 100). Si el servidor capa por debajo, la paginación usa el
   * `pagination.limit` EFECTIVO de la respuesta, no este valor.
   */
  private readonly pageLimit = 1000;
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
    const drops: DropCounts = { ...NO_DROPS };
    let fetchedRaw = 0;
    let skipped = 0;
    let sample: string | null = null;
    let requestOk = false;

    try {
      let totalPages = this.maxPages;
      for (let page = 1; page <= Math.min(totalPages, this.maxPages); page++) {
        const { entries, pagination, path } = await this.fetchPricesPage(apiKey, setExternalId, page);
        requestOk = true;
        if (entries.length === 0) break;
        fetchedRaw += entries.length;

        // Observabilidad (§4.15b): LOG UN ejemplo de la 1ª entrada cruda para verificar el
        // esquema real en Railway. NO contiene secretos (solo datos de precio de una carta).
        if (sample == null) {
          sample = truncate(JSON.stringify(entries[0]), 800);
          this.logger.log(
            `PokemonPriceTracker bulk: GET ${path} OK (set ${setExternalId}, pág 1): ` +
              `${entries.length} entradas, pagination=${JSON.stringify(pagination)}. ` +
              `Ejemplo de entrada cruda: ${sample}`,
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
          const mapped = this.mapEntry(entry, setExternalId, format);
          rows.push(...mapped.added);
          addDrops(drops, mapped.drops);
        }

        totalPages = this.pagesFrom(pagination, entries.length, page);
      }
    } catch (e) {
      // Money-safe: ante fallo/timeout/429 NO borramos precios; devolvemos lo acumulado + log.
      // Diagnóstico: el mensaje del ProviderHttpError trae status + cuerpo (sin credenciales).
      this.logger.warn(
        `PokemonPriceTracker bulk: EL REQUEST FALLÓ para el set ${setExternalId}: ` +
          `${(e as Error).message}. Se devuelven ${rows.length} filas ` +
          '(precios previos quedan STALE, no se borran).',
      );
    }

    skipped += drops.notObject + drops.foreignSet + drops.noFinish + drops.noMarket;
    this.logSummary({ setExternalId, requestOk, fetchedRaw, mapped: rows.length, drops, sample, format });
    // v1.22-1 (§4.22g): `requestOk` gobierna el REEMPLAZO money-safe de `pricedFinishesSnapshot` en
    // `price-ingest`. Es `false` si NINGUNA página respondió (fallo total / sin key) → los snapshots
    // NO se tocan (no se destruye evidencia por un fallo transitorio). El modo sample-only devuelve
    // `requestOk:true` pero `rows: []`, y el gate `requestOk && rows>0` igual lo excluye.
    return { rows, fetchedRaw, skipped, requestOk };
  }

  /**
   * Diagnóstico observable (P-6): deja SIEMPRE una línea que distingue los dos modos de falla.
   *  - "EL REQUEST FALLÓ" (arriba, en el catch) → HTTP + cuerpo del error del proveedor.
   *  - "el request PASÓ pero NADA mapeó" (aquí) → ejemplo de entrada cruda + desglose de omisiones.
   */
  private logSummary(s: {
    setExternalId: string;
    requestOk: boolean;
    fetchedRaw: number;
    mapped: number;
    drops: DropCounts;
    sample: string | null;
    format: MarketFormat | null;
  }): void {
    const breakdown =
      `${s.drops.noFinish} sin acabado reconocible, ${s.drops.noMarket} sin market válido, ` +
      `${s.drops.foreignSet} de otro set, ${s.drops.notObject} no-objeto`;
    const head =
      `PokemonPriceTracker bulk resumen (set ${s.setExternalId}): ` +
      `${s.fetchedRaw} entradas crudas → ${s.mapped} filas mapeadas [${breakdown}].`;

    if (s.requestOk && s.fetchedRaw > 0 && s.mapped === 0 && s.format) {
      // El request pasó pero el MAPEO no reconoció nada: el ejemplo crudo dice qué campos vinieron.
      this.logger.warn(
        `${head} El request PASÓ pero NADA mapeó → revisa los nombres de campo contra el ejemplo ` +
          `crudo: ${s.sample ?? 'n/d'}`,
      );
      return;
    }
    this.logger.log(head);
  }

  /**
   * Páginas totales a recorrer, a partir del `pagination` de la respuesta (§P-6). Prioriza el
   * `total`/`limit` EFECTIVOS del servidor (si capó el `limit` pedido, la cuenta sigue bien);
   * si el proveedor no manda `pagination`, cae al heurístico "página incompleta = última".
   */
  private pagesFrom(pagination: PageInfo | null, entriesInPage: number, currentPage: number): number {
    if (pagination) {
      if (pagination.totalPages != null && pagination.totalPages > 0) return pagination.totalPages;
      const limit = pagination.limit && pagination.limit > 0 ? pagination.limit : this.pageLimit;
      if (pagination.total != null && pagination.total >= 0) return Math.ceil(pagination.total / limit);
      if (pagination.hasMore != null) return pagination.hasMore ? currentPage + 1 : currentPage;
    }
    // Sin metadatos de paginación: si la página vino incompleta, era la última.
    return entriesInPage < this.pageLimit ? currentPage : currentPage + 1;
  }

  /**
   * GET de UNA página del barrido por set. Prueba las rutas candidatas hasta que una responda
   * (luego memoriza la ganadora). Lanza `ProviderHttpError` con status + cuerpo si ninguna sirve.
   */
  private async fetchPricesPage(
    apiKey: string,
    setExternalId: string,
    page: number,
  ): Promise<PricesPage> {
    const candidates = this.resolvedPath ? [this.resolvedPath] : this.pricesPaths;
    let lastError: Error | null = null;

    for (const path of candidates) {
      const qs = new URLSearchParams({
        setId: setExternalId,
        limit: String(this.pageLimit),
        page: String(page),
      });
      const res = await fetch(`${this.host}${path}?${qs.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        // Diagnóstico: el CUERPO del error del proveedor dice si es contrato (400), ruta (404),
        // auth (401/403) o cuota (429). Nunca se loguea la key ni los headers.
        const body = truncate(await safeText(res), 300);
        lastError = new ProviderHttpError(res.status, body, path);
        if (candidates.length > 1) {
          this.logger.warn(`PokemonPriceTracker bulk: ${lastError.message} → probando la siguiente ruta.`);
        }
        continue;
      }
      const body: unknown = await res.json();
      this.resolvedPath = path;
      return { entries: this.extractEntries(body), pagination: this.extractPagination(body), path };
    }
    throw lastError ?? new Error('sin rutas candidatas');
  }

  /**
   * Extrae el array de entradas del cuerpo (defensivo con el envelope): el formato documentado es
   * `{ data: [], pagination: {} }`; se toleran `{ cards: [] }`, `{ results: [] }` y un array pelón.
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

  /** Normaliza el objeto `pagination` del envelope (`{ total, page, limit }`), o null. */
  private extractPagination(body: unknown): PageInfo | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const raw = (body as Record<string, unknown>)['pagination'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const p = raw as Record<string, unknown>;
    return {
      total: numberOrNull(p['total'] ?? p['totalCount'] ?? p['count']),
      page: numberOrNull(p['page'] ?? p['currentPage']),
      limit: numberOrNull(p['limit'] ?? p['pageSize'] ?? p['perPage']),
      totalPages: numberOrNull(p['totalPages'] ?? p['pages'] ?? p['pageCount']),
      hasMore: typeof p['hasMore'] === 'boolean' ? (p['hasMore'] as boolean) : boolOrNull(p['hasNextPage']),
    };
  }

  /**
   * Mapea UNA entrada cruda → filas por (carta, acabado), con la MONEDA y UNIDAD del `format`
   * confirmado por el operador (no del payload). Money-safe: valida y OMITE lo mal formado,
   * contando el MOTIVO de cada omisión (diagnóstico P-6).
   *
   * Soporta los shapes que documenta el proveedor y sus variantes probables:
   *  (A) `entry.prices = { <printing>: { marketPrice } | <número> }` (tcgplayer-like).
   *  (B) PLANO (el de `/api/prices`): `entry.printing` + `entry.marketPrice`.
   *  (C) `entry.prices | entry.printings | entry.variants = [ { printing, marketPrice }, … ]`.
   */
  private mapEntry(
    entry: unknown,
    setExternalId: string,
    format: MarketFormat,
  ): { added: BulkPriceRow[]; drops: Partial<DropCounts> } {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { added: [], drops: { notObject: 1 } };
    }
    const e = entry as Record<string, unknown>;

    // El proveedor devuelve `setId` por carta: si el filtro no se respetó y viene otro set, se
    // DESCARTA (money-safe: el fallback (set, number) del ingest podría casar la carta equivocada).
    const entrySetId = firstString(e, ['setId', 'set', 'setCode']);
    if (entrySetId && entrySetId.toLowerCase() !== setExternalId.toLowerCase()) {
      return { added: [], drops: { foreignSet: 1 } };
    }

    // Identificadores de la carta. `id`/`cardId` son del namespace pokemontcg.io (`sv8-1`), igual
    // que `Card.externalId`; `cardNumber` alimenta el fallback (set, number) del ingest.
    const externalId = firstString(e, ['id', 'cardId']);
    const number = firstString(e, ['cardNumber', 'number', 'collectorNumber']);

    const added: BulkPriceRow[] = [];
    const drops: DropCounts = { ...NO_DROPS };
    const push = (rawFinish: unknown, rawMarket: unknown): void => {
      const finish = normalizeFinishAlias(rawFinish);
      if (finish == null) {
        // Acabado desconocido o AUSENTE → OMITE. Nunca se atribuye a `normal` (money-safe): un
        // precio de holo escrito como normal cotizaría de más al comprar. El resumen loguea
        // cuántas cayeron aquí y un ejemplo crudo, para ampliar el mapa de alias si hace falta.
        drops.noFinish += 1;
        return;
      }
      const marketCents = toCents(extractMarketNumber(rawMarket), format.unit);
      if (marketCents == null) {
        drops.noMarket += 1;
        return;
      }
      // v1.22-1 (§4.22g candado 2): el PRECIO usa el alias tolerante (`normalizeFinishAlias`); la
      // aptitud para la LISTA BLANCA usa el alias VERIFICADO (espejo estricto de TCG_KEY_TO_FINISH).
      // Un `foil` SUPUESTO persiste su PriceReference pero NO entra a `pricedFinishesSnapshot`.
      const finishAliasVerified = normalizeVerifiedFinishAlias(rawFinish) !== null;
      added.push({
        externalId,
        setExternalId,
        number,
        finish,
        marketCents,
        currency: format.currency,
        finishAliasVerified,
      });
    };

    // (A) / (C): colecciones de precios por acabado dentro de la entrada.
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

    // (B) PLANO — el shape documentado de `/api/prices`: `printing` + `marketPrice` en la entrada.
    push(firstString(e, FINISH_KEYS), e['marketPrice'] ?? e['market'] ?? e['price']);
    return { added, drops };
  }
}

/** Campos donde el proveedor puede traer el ACABADO (`printing` es el documentado). */
const FINISH_KEYS = ['printing', 'variant', 'finish', 'printingName', 'subTypeName'];

/** Devuelve el primer valor string no vacío entre `keys`, o null. */
function firstString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** Extrae el número de market crudo (de un número o de `{ marketPrice|market }`), sin decidir unidad. */
function extractMarketNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['marketPrice', 'market', 'price']) {
      const m = o[k];
      if (typeof m === 'number' && Number.isFinite(m)) return m;
    }
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

/** Lee el cuerpo de una respuesta de error sin reventar si no es texto legible. */
async function safeText(res: { text?: () => Promise<string> }): Promise<string> {
  try {
    return typeof res.text === 'function' ? await res.text() : '';
  } catch {
    return '';
  }
}

function addDrops(target: DropCounts, add: Partial<DropCounts>): void {
  target.notObject += add.notObject ?? 0;
  target.foreignSet += add.foreignSet ?? 0;
  target.noFinish += add.noFinish ?? 0;
  target.noMarket += add.noMarket ?? 0;
}
