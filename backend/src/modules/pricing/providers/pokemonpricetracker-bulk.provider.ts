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
 * Paginación normalizada del envelope v2 del proveedor. En la API v2 los campos vienen al NIVEL
 * RAÍZ del cuerpo (`{ data, total, count, limit, offset, hasMore }`); se tolera también el shape
 * anidado `{ pagination: { … } }` por robustez. La paginación es por `offset` (no por `page`).
 */
interface PageInfo {
  /** Total de cartas del set (no de la página). */
  total: number | null;
  /** Cartas devueltas en ESTA página. */
  count: number | null;
  /** Tamaño de página EFECTIVO que aplicó el servidor. */
  limit: number | null;
  /** Offset de ESTA página (0-based). */
  offset: number | null;
  /** ¿Hay más páginas después de esta? (señal directa del proveedor). */
  hasMore: boolean | null;
}

/** Una página cruda del barrido por set. */
interface PricesPage {
  entries: unknown[];
  pagination: PageInfo | null;
  /** URL EXACTA que respondió (host+path+query, SIN credenciales) — observabilidad del log. */
  url: string;
}

/** Motivos de OMISIÓN del mapeo (diagnóstico: distingue "no mapeó" de "falló el request"). */
interface DropCounts {
  /** Entrada que no es un objeto mapeable. */
  notObject: number;
  /** El proveedor devolvió una carta de OTRO set (el filtro `setId` no se respetó). */
  foreignSet: number;
  /** Hay precio pero el acabado (`finish`) es desconocido o falta → NUNCA se atribuye a `normal`. */
  noFinish: number;
  /** El acabado es válido pero el market es inválido (ausente/NaN/<=0). */
  noMarket: number;
}

const NO_DROPS: DropCounts = { notObject: 0, foreignSet: 0, noFinish: 0, noMarket: 0 };

/**
 * Error HTTP del proveedor con el CUERPO recortado (para distinguir 4xx de contrato de un 5xx).
 * P-7 (2026-08-19): el mensaje incluye la **URL EXACTA** (host+path+query, SIN el header
 * Authorization ni la key) para diagnosticar de un vistazo el 404 sistemático — antes solo decía
 * "HTTP 404" sin decir contra qué endpoint.
 */
class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly bodySnippet: string,
    /** URL completa (host+path+query) sin credenciales. */
    readonly url: string,
  ) {
    super(`HTTP ${status} en ${url}${bodySnippet ? ` — cuerpo: ${bodySnippet}` : ''}`);
    this.name = 'ProviderHttpError';
  }
}

/**
 * PokemonPriceTrackerBulkProvider — implementación PRIMARIA del `BulkPriceProvider`
 * (WS-A, ARCHITECTURE §4.15b). Barre TODAS las cartas de un set con la **API v2** de precios:
 *
 *   GET https://www.pokemonpricetracker.com/api/v2/cards?setId=<CardSet.externalId>&fetchAllInSet=true
 *   Authorization: Bearer <POKEMONPRICETRACKER_API_KEY>
 *   Accept: application/json
 *   → { data: [ { id, setId, cardNumber, tcgplayer: { prices: { holofoil: { market }, … } }, … } ],
 *       total, count, limit, offset, hasMore }
 *
 * **P-7 (2026-08-19):** BUG P0 — la versión anterior pegaba a `/api/prices` y `/api/v1/prices`
 * (con `?setId=&limit=&page=`). Esos endpoints YA NO EXISTEN → respondían **HTTP 404 sistemático**
 * a cada set, el `catch` money-safe devolvía 0 filas sin borrar nada, y el catálogo se quedó todo
 * el día sin precios. El endpoint REAL y vigente es la **API v2** (`GET /api/v2/cards`), que filtra
 * por el MISMO `setId` estilo pokemontcg.io (`base1`, `sv8`, `ex14`…) y, con `fetchAllInSet=true`,
 * devuelve el set ENTERO (los topes por request no aplican; hasta 200+ cartas). La paginación es
 * por `offset` (envelope al NIVEL RAÍZ: `total`, `count`, `limit`, `offset`, `hasMore`).
 *
 * **P-6 (2026-08-18, DEVOPS_NOTES §23.9):** una versión aún anterior hacía
 * `POST /api/v1/cards/bulk-price` esperando una lista `{ cardIds }` — no aceptaba filtro por set.
 * El barrido por set NO se hace por-lista: no hay flujo que lo necesite (el ingest siempre trabaja
 * set por set) y construir los `cardIds` desde la BD sería más requests y más frágil.
 *
 * RUTA NO VERIFICADA EN RUNTIME: el egress del sandbox de desarrollo bloquea el dominio del
 * proveedor, así que la fuente es su OpenAPI público + clientes reales en GitHub. El shape v2 y el
 * endpoint se validan además en la 1ª corrida acotada en staging (runbook devops).
 *
 * SEGURIDAD:
 *  - **Host FIJO** (`www.pokemonpricetracker.com`, sin parte controlable) → sin SSRF (patrón
 *    `PokemonTcgIoClient`). El cliente NUNCA acepta URLs arbitrarias. El único valor interpolado
 *    es `CardSet.externalId`, y va URL-encoded como query param (`URLSearchParams`).
 *  - La API key se lee SOLO de `process.env.POKEMONPRICETRACKER_API_KEY` (vía ConfigService).
 *    NUNCA se hardcodea, se loguea ni se commitea (repo público). Los logs de diagnóstico jamás
 *    incluyen headers ni la URL con credenciales (la URL logueada solo trae el query, sin token).
 *
 * FAIL-CLOSED de moneda/unidad (WS-A, seguridad Media + qa): el proveedor de paga **NO persiste
 * precios bajo una moneda/unidad ASUMIDA**. El formato lo fija el operador con
 * `POKEMONPRICETRACKER_MARKET_FORMAT` (sin default):
 *  - **Sin formato** → modo **sample-only**: hace el fetch, LOGUEA la muestra cruda (sin key/headers)
 *    y persiste **NADA** (`rows: []`). Así el flip es seguro aunque el humano olvide el runbook.
 *  - **Con formato** → mapea EXACTO: `usd`→ el ingest aplica FX+colchón; `mxn`→ sin conversión;
 *    `*_dollars`→ ×100; `*_cents`→ sin ×100. La moneda de la fila viene del FORMATO (no del payload).
 *
 * MONEY-SAFE (§4.15d): valida `market > 0`, mapea el acabado→`Finish` (desconocida o AUSENTE →
 * OMITE, jamás la atribuye a `normal`), descarta cartas de otro set, y resuelve la carta aguas
 * abajo (PriceIngestService). Sin key / HTTP fail → `{ rows: [] }` + log (precios STALE, no se borran).
 */
@Injectable()
export class PokemonPriceTrackerBulkProvider implements BulkPriceProvider {
  readonly source: PriceSource = 'pokemonpricetracker';
  private readonly logger = new Logger(PokemonPriceTrackerBulkProvider.name);
  /** Host FIJO — no configurable por el usuario (anti-SSRF). */
  private readonly host = 'https://www.pokemonpricetracker.com';
  /** Endpoint v2 ÚNICO del barrido por set (P-7). */
  private readonly pricesPath = '/api/v2/cards';
  /**
   * Tamaño de página al paginar por `offset`. Con `fetchAllInSet=true` el proveedor devuelve el set
   * entero en una sola respuesta (hasta 200+); este `limit` solo aplica si el envelope señala
   * `hasMore` y hace falta un segundo request.
   */
  private readonly pageLimit = 200;
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
      // Barrido por `offset`: el 1er request va con `setId&fetchAllInSet=true` (sin offset). Si el
      // envelope señala `hasMore`/`total`, se pagina con `offset=<recibidas>&limit=200` hasta agotar.
      let received = 0;
      let offset: number | null = null; // null = 1er request (sin params de offset/limit)
      for (let page = 0; page < this.maxPages; page++) {
        const { entries, pagination, url } = await this.fetchPricesPage(apiKey, setExternalId, offset);
        requestOk = true;
        if (entries.length === 0) break;
        received += entries.length;
        fetchedRaw += entries.length;

        // Observabilidad (§4.15b): LOG UN ejemplo de la 1ª entrada cruda para verificar el
        // esquema real en Railway. NO contiene secretos (solo datos de precio de una carta).
        if (sample == null) {
          sample = truncate(JSON.stringify(entries[0]), 800);
          this.logger.log(
            `PokemonPriceTracker bulk: GET ${url} OK (set ${setExternalId}, pág ${page + 1}): ` +
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

        if (!this.hasMorePages(pagination, received)) break;
        offset = received; // siguiente página arranca en lo ya recibido.
      }
    } catch (e) {
      // Money-safe: ante fallo/timeout/429 NO borramos precios; devolvemos lo acumulado + log.
      // Diagnóstico P-7: el mensaje del ProviderHttpError trae status + URL EXACTA + cuerpo (sin
      // credenciales) → un 404 deja claro contra QUÉ endpoint falló.
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
   *  - "EL REQUEST FALLÓ" (arriba, en el catch) → HTTP + URL + cuerpo del error del proveedor.
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
   * ¿Hay más páginas después de la actual? (§P-7, paginación por `offset`). Prioriza la señal
   * DIRECTA `hasMore`; si no viene, deriva por `total` vs. lo ya recibido. Sin metadatos de
   * paginación NO continúa: con `fetchAllInSet=true` el proveedor devuelve el set entero en una
   * respuesta, así que la ausencia de envelope significa "esto es todo" (anti-bucle).
   */
  private hasMorePages(pagination: PageInfo | null, received: number): boolean {
    if (!pagination) return false;
    if (pagination.hasMore === true) return true;
    if (pagination.hasMore === false) return false;
    if (pagination.total != null && pagination.total >= 0) return received < pagination.total;
    return false;
  }

  /**
   * GET de UNA página del barrido por set (API v2). `offset === null` → 1er request
   * (`setId&fetchAllInSet=true`, sin offset/limit); `offset` numérico → página siguiente
   * (`…&limit=200&offset=<n>`). Lanza `ProviderHttpError` (status + URL + cuerpo) si no responde OK.
   */
  private async fetchPricesPage(
    apiKey: string,
    setExternalId: string,
    offset: number | null,
  ): Promise<PricesPage> {
    const qs = new URLSearchParams({
      setId: setExternalId,
      fetchAllInSet: 'true',
    });
    if (offset != null) {
      qs.set('limit', String(this.pageLimit));
      qs.set('offset', String(offset));
    }
    // URL sin credenciales: el token va SOLO en el header Authorization, jamás en el query.
    const url = `${this.host}${this.pricesPath}?${qs.toString()}`;
    const res = await fetch(url, {
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
      throw new ProviderHttpError(res.status, body, url);
    }
    const body: unknown = await res.json();
    return { entries: this.extractEntries(body), pagination: this.extractPagination(body), url };
  }

  /**
   * Extrae el array de entradas del cuerpo (defensivo con el envelope): el formato v2 es
   * `{ data: [], … }`; se toleran `{ cards: [] }`, `{ results: [] }`, `{ prices: [] }` y un array pelón.
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
   * Normaliza la paginación del envelope v2. En v2 los campos vienen al NIVEL RAÍZ del cuerpo
   * (`{ data, total, count, limit, offset, hasMore }`); se tolera también el shape anidado
   * `{ pagination: { … } }` por robustez. Devuelve null si el cuerpo no es un objeto.
   */
  private extractPagination(body: unknown): PageInfo | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const root = body as Record<string, unknown>;
    const nested = root['pagination'];
    const p =
      nested && typeof nested === 'object' && !Array.isArray(nested)
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
   * Mapea UNA entrada cruda → filas por (carta, acabado), con la MONEDA y UNIDAD del `format`
   * confirmado por el operador (no del payload). Money-safe: valida y OMITE lo mal formado,
   * contando el MOTIVO de cada omisión (diagnóstico P-6).
   *
   * Fuente PRINCIPAL (shape REAL v2, confirmado): `entry.tcgplayer.prices = { <finishKey>: { market } }`
   * (idéntico a pokemontcg.io). Se conservan como FALLBACK tolerante los shapes previos:
   *  (A) `entry.prices = { <printing>: { marketPrice } | <número> }`.
   *  (B) PLANO: `entry.printing` + `entry.marketPrice`.
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

    // FUENTE PRINCIPAL (v2 real): `entry.tcgplayer.prices = { <finishKey>: { market } }`. Se itera
    // por acabado. `extractMarketNumber` lee `.market` (dólares float con `usd_dollars` → ×100).
    // OJO money-safe: solo se toma el `market` que cuelga de un ACABADO nombrado; jamás un `market`
    // suelto de nivel superior sin acabado.
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

    // (A) / (C) FALLBACK: colecciones de precios por acabado dentro de la entrada.
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

    // (B) PLANO FALLBACK: `printing` + `marketPrice` en la entrada.
    push(firstString(e, FINISH_KEYS), e['marketPrice'] ?? e['market'] ?? e['price']);
    return { added, drops };
  }
}

/**
 * Campos donde un shape FALLBACK puede traer el ACABADO. En el shape PRIMARIO v2 el acabado es la
 * CLAVE del objeto `tcgplayer.prices` (`holofoil`, `reverseHolofoil`…), no un campo `printing`;
 * estos nombres solo aplican a los fallbacks tolerantes (B/C) que el adapter conserva.
 */
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

/** Extrae el número de market crudo (de un número o de `{ market|marketPrice|price }`), sin decidir unidad. */
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
