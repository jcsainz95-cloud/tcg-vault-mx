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
// v1.50.3 (§4.38m.2): el gate de EVIDENCIA reusa el MISMO predicado de antigüedad que la lectura. Dos
// implementaciones de «¿esto es viejo?» serían dos verdades sobre la frescura.
import { isStaleEstimate } from '../../../common/graded-estimate';

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
  /**
   * v1.51-b (TL-GE1) — `metadata.apiCallsConsumed` **de ESTA respuesta**. `PptApiClient` ya lo extraía
   * y este camino lo TIRABA, así que el único coste atribuible a la llamada se perdía y había que
   * reconstruirlo restando el contador diario del singleton (que pisa cualquier otra respuesta de PPT).
   * `null` = el proveedor no lo reportó ⇒ el gasto de esa página NO es atribuible.
   */
  apiCallsConsumed: number | null;
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
 * v1.50.2 (§4.38h.1) — **TRUNCADO DE LA MUESTRA CRUDA: 800 → 4000 caracteres.**
 *
 * No es cosmético: **con 800 el bloque PSA queda CORTADO** y el diagnóstico produce un **falso
 * negativo** («el proveedor no manda PSA» cuando sí lo manda). Una entrada de la API v2 con
 * `includeEbay=true` arrastra el bloque `ebay.salesByGrade` DESPUÉS de los precios base, así que es
 * justo lo primero que se pierde al recortar. Es cambio de **observabilidad**, no de dinero: el log ya
 * es seguro (la API key va en el header, jamás en la URL ni en el log, §4.15).
 */
const GRADED_SAMPLE_TRUNCATE = 4000;

/**
 * v1.50.3-g (§4.38h.1-quater) — **la SONDA**. Marca fija con la que el dueño encuentra el reporte por
 * set sin bucear en el log: `grep "PPT-GRADED-SONDA"`. Va en `warn` a propósito — no es ruido de
 * rutina, es la respuesta a la pregunta que bloquea la fase 2.
 */
const GRADED_PROBE_TAG = 'PPT-GRADED-SONDA';
/** Cuántos bloques de grados CRUDOS se logean por set. 3 basta para ver el shape; 200 sería ruido. */
const GRADED_PROBE_MAX_BLOCK_SAMPLES = 3;

// ⛔ v1.51-b (TL-GE1) — aquí vivía `creditsSpent(before, after)`, que restaba dos lecturas de
// `PptApiClient.dailyRemaining()`. Se RETIRA a propósito y no se sustituye por otra resta: ese
// contador es estado del singleton del proceso y lo pisa cualquier respuesta de PPT (el barrido de
// precios RAW corre en la misma corrida), así que la resta atribuía a las llamadas graded créditos
// que no eran suyos. El coste atribuible se suma de `metadata.apiCallsConsumed`, por llamada.

/**
 * SONDA, por entrada: **clasifica y nada más**. Su tipo de retorno NO contiene filas, así que ninguna
 * ruta que pase por aquí puede persistir — la propiedad money-safe es del TIPO, no de la disciplina de
 * quien la llame (que era lo frágil del viejo «sample-only»).
 *
 * Clasifica por **observación pura** (como si `GRADED_FORMAT=auto`), ignorando el override del
 * operador: la pregunta de la sonda es *«¿qué sirve el proveedor?»* y un conteo filtrado por lo que
 * nosotros le pedimos mirar no la contesta. El override sigue mandando —intacto— en el camino que
 * escribe (`parseGradedEntry`), que es donde expresa una intención sobre el DINERO.
 */
function detectGradedShape(entry: unknown): {
  shape: 's1' | 's2' | null;
  sawGradedBlock: boolean;
  externalId: string | null;
  /** El bloque de grados CRUDO (truncado) — el insumo con el que un humano confirma el esquema. */
  blockSample: string | null;
} {
  const none = { shape: null, sawGradedBlock: false, externalId: null, blockSample: null } as const;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ...none };
  const e = entry as Record<string, unknown>;
  const externalId = firstString(e, ['id', 'cardId']);
  const salesByGrade = pickObject(pickObject(e['ebay']), 'salesByGrade');
  const gradedPrices = pickObject(e, 'gradedPrices');
  if (salesByGrade == null && gradedPrices == null) return { ...none, externalId };
  return {
    shape: salesByGrade != null ? 's1' : 's2',
    sawGradedBlock: true,
    externalId,
    blockSample: truncate(
      JSON.stringify(salesByGrade != null ? { salesByGrade } : { gradedPrices }),
      GRADED_SAMPLE_TRUNCATE,
    ),
  };
}

/** Las dos hipótesis de shape que el parser SONDEA, en orden fijo (§4.38h.1). */
export type GradedFormat = 'auto' | 'sales_by_grade' | 'graded_prices';
const GRADED_FORMATS: readonly GradedFormat[] = ['auto', 'sales_by_grade', 'graded_prices'];

/** Qué campo del objeto S1 es el precio. Empata 1:1 con el dial `graded_estimate_source_stat`. */
const GRADED_STAT_FIELD = {
  median: 'medianPrice',
  average: 'averagePrice',
  smart: 'smartMarketPrice',
} as const;
type GradedStat = keyof typeof GRADED_STAT_FIELD;

/**
 * v1.50.3 (§4.38m.2) — **GATE DE EVIDENCIA**: campo del bloque S1 que trae la fecha de la **última
 * venta observada**. Es el nombre que el arquitecto declaró; si el proveedor usara otro, el operador lo
 * corrige **sin deploy** con `POKEMONPRICETRACKER_GRADED_EVIDENCE_FIELD` (mismo patrón que
 * `POKEMONPRICETRACKER_GRADED_FIELD`). **No se sondean alias a ciegas** (P-6): un nombre adivinado que
 * casualmente contenga una fecha abriría la puerta que este gate existe para cerrar.
 */
const GRADED_EVIDENCE_FIELD_DEFAULT = 'lastSaleDate';

/**
 * Parsea la fecha de EVIDENCIA a `YYYY-MM-DD`. Acepta `YYYY-MM-DD`, ISO-8601 completo y epoch en ms
 * (número). **Cualquier otra cosa ⇒ `null` = DESCONOCIDO**, y «desconocido» NO es «fresco»: misma
 * doctrina fail-closed que el `count` desconocido de S2 en (h.1).
 */
function parseEvidenceDate(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t === '') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * UNA fila de estimado PSA identificada POSITIVAMENTE por el parser. `amountCents` va en la moneda de
 * `currency` (INV-FX: quien persiste decide dónde cae el numeral, §4.38a).
 */
export interface GradedEstimateSourceRow {
  externalId?: string | null;
  number?: string | null;
  /** `"10"` | `"9"` — el grado, no la clave. */
  gradeValue: string;
  amountCents: number;
  currency: 'USD' | 'MXN';
  /**
   * Muestra observada (`count`). `null` = el shape **no la trae** (S2) ⇒ DESCONOCIDO ⇒ fail-closed.
   * NUNCA se persiste en la tabla de dinero: va a log + `AuditLog` del job (§4.38k.1).
   */
  count: number | null;
  /**
   * v1.50.3 (§4.38m.2) — fecha de la ÚLTIMA VENTA observada (`YYYY-MM-DD`), la que el criterio 109 dice
   * que de verdad importa. **Sigue sin persistirse**: la columna `PriceReference.evidenceDate` YA
   * existe (M-43, v1.50.3-f), pero **cablear el escritor y el `stale()` contra `evidenceDate ??
   * capturedDate` no entró en el alcance de M-43** — queda anotado en `TECH_DEBT.md`. Hoy viaja para
   * log/`AuditLog` y porque una fila solo llega aquí si YA pasó el gate de evidencia de la escritura.
   */
  evidenceDate: string;
  source: PriceSource;
}

/** Por qué se DESCARTÓ una entrada (traza obligatoria del job, §4.38h.4). */
export interface GradedDropSample {
  externalId: string | null;
  reason:
    | 'unrecognized_shape'
    | 'sample_too_small'
    | 'not_a_positive_amount'
    // v1.50.3 (§4.38m.2) — GATE DE EVIDENCIA. Separados a propósito: «la venta es vieja» y «no sé
    // cuándo fue la venta» son diagnósticos DISTINTOS para el operador, aunque la acción sea la misma
    // (no escribir). Fundirlos haría indistinguible «el proveedor dejó de recibir ventas de esta carta»
    // de «el campo se llama de otra forma y hay que ajustar el dial».
    | 'evidence_too_old'
    | 'evidence_unknown'
    /**
     * v1.50.3-a (§4.38h.1-bis) — el proveedor sirvió **S2** (`gradedPrices.psaN`, escalar), declarado
     * **NO PERSISTIBLE**. Motivo PROPIO y contado APARTE de los otros dos a propósito: «el proveedor
     * cambió de shape» y «esta carta tiene pocas ventas» exigen **reacciones opuestas**, y un contador
     * único los vuelve indistinguibles **justo cuando hay que decidir si escalar**. Este motivo NO es
     * un descarte de rutina: es la **señal de escalada** de (h.1-bis).
     */
    | 'shape_not_persistible_s2';
  count: number | null;
  /** Muestra CRUDA del bloque que no se reconoció (truncada). Es el insumo para confirmar el shape. */
  sample: string;
}

/**
 * ¿Este 4xx significa «el proveedor NO admite el parámetro»? (v1.50.2, techlead)
 *
 * El predicado era `status !== 429 && 400 <= status < 500`, o sea **cualquier** 4xx. Un veredicto de
 * ESCALADA no es un error más: dispara una decisión de ARQUITECTURA y de PRESUPUESTO (rediseñar el
 * ingest hacia «una petición por carta», 2 créditos × carta, con curaduría por lista). Emitirlo por un
 * 401 le cuesta al equipo un rediseño que no hacía falta, cuando lo que había que hacer era **rotar la
 * clave**. Los tres excluidos son, cada uno, un diagnóstico DISTINTO y ninguno habla del parámetro:
 *
 *  - **401 / 403** — la credencial: clave ausente, mal escrita, vencida o sin el plan que incluye eBay.
 *    El servidor está diciendo «no sé quién eres», no «ese parámetro no existe».
 *  - **404** — el recurso: el `pptSetId` cacheado en `CardSet.pptSetId` dejó de existir del lado del
 *    proveedor. Se arregla re-mapeando el set, no rediseñando el barrido.
 *
 * Todos ellos caen a la rama de FALLO DE REQUEST NORMAL: se loguea, no se escribe nada, los estimados
 * previos quedan intactos y **la corrida sigue con los demás sets**. Fail-closed sin falsa alarma.
 *
 * `429` sigue fuera por su propia razón (cuota; lo maneja `PptDailyLimitError` / el throttle).
 */
const NOT_A_PARAM_REJECTION = [401, 403, 404, 429] as const;
function isParamRejection(status: number): boolean {
  return status >= 400 && status < 500 && !NOT_A_PARAM_REJECTION.includes(status as 401);
}

export interface GradedEstimateFetchResult {
  rows: GradedEstimateSourceRow[];
  fetchedRaw: number;
  /** Entradas que el parser NO identificó positivamente como monto ⇒ **no se escribió nada de ellas**. */
  drops: GradedDropSample[];
  requestOk: boolean;
  dailyLimited: boolean;
  /**
   * Presupuesto diario VIVO tras la última respuesta (para decidir si queda cuota). ⚠️ v1.51-b
   * (TL-GE1): es un contador GLOBAL del proceso, **no** el gasto de esta llamada — cualquier otra
   * petición a PPT lo mueve. Para COSTE usa `gradedApiCallsConsumed`; restar dos lecturas de éste es
   * exactamente el bug que se corrigió.
   */
  dailyRemaining: number | null;
  /**
   * ⛔ **ESCALADA (regla 9)** — no es un error recuperable ni algo que el código deba «arreglar».
   * Se puebla cuando la observación real contradice la premisa del diseño: `includeEbay=true` **no**
   * combina con `fetchAllInSet=true`. Eso implicaría **una petición por carta**, que invalida el modelo
   * de barrido por set y obliga a rediseñar hacia un ingest **curado por lista** — decisión de
   * ARQUITECTURA y de COSTO, no de implementación. El job **para** y **no** cae al modo por carta.
   */
  escalate: { reason: 'ebay_not_supported_with_set_sweep' | 'no_graded_block_in_response'; detail: string } | null;
  /**
   * v1.50.2 (techlead) — ¿ALGUNA entrada de ESTE set traía bloque de grados reconocible?
   *
   * Es el insumo que permite al orquestador evaluar la ambigüedad de `no_graded_block_in_response` **a
   * escala de CORRIDA** en vez de por set: en cuanto UN set del run vio el bloque, el shape queda
   * CONFIRMADO y los demás sets sin bloque son un estado de datos normal (un set sin ventas PSA), no
   * evidencia de que el proveedor ignorara `includeEbay`. Sin este campo, el orquestador solo veía el
   * veredicto ya emitido por set y no podía distinguir los dos casos.
   */
  sawGradedBlock: boolean;
  /**
   * v1.50.3-a (§4.38h.1-bis) — **cuántas CARTAS de este set trajeron cada shape**, contadas por
   * ENTRADA (no por grado) porque la pregunta que responden es *«¿qué está sirviendo el proveedor?»*,
   * no *«cuántas filas de dinero salieron»*.
   *
   * Es el insumo del veredicto de escalada **a escala de CORRIDA**: si PPT sirve mayoritariamente
   * `gradedPrices` (S2), la fase 2 **no es viable con este proveedor** y la decisión —degradar a manual
   * de forma permanente, buscar otro proveedor o pagar el plan que exponga `salesByGrade`— es de
   * **producto y de costo**, no de código. Se cuenta aquí y se juzga arriba, por la misma razón que
   * `sawGradedBlock`: el provider solo ve UN set y no puede sostener ese veredicto solo.
   */
  shapeCounts: { s1: number; s2: number };
  /**
   * v1.50.3-g (§4.38h.1-quater) — **esta llamada fue una SONDA de solo lectura** (`writeFormat == null`):
   * se consultó al proveedor, se logueó la muestra cruda y **`rows` es [] por construcción** (la sonda
   * no ejecuta el parser, así que no existe el objeto que se persistiría). Viaja en el resultado porque
   * el orquestador tiene que poder decir en el veredicto si la corrida OBSERVÓ o INGESTÓ: «0 escritas»
   * significa cosas opuestas en cada modo.
   */
  probe: boolean;
  /**
   * v1.51-c (R1-ter) — **por qué NO se emitió NI UNA petición para este set**, o `null` si sí se
   * emitió (haya respondido OK o no).
   *
   * ### El defecto que cierra
   * `requestOk: false` significaba dos cosas incompatibles: «se pidió y falló» y «no se pidió». El
   * veredicto solo podía leer la primera, así que ante los dos `return empty` de abajo —falta de
   * `POKEMONPRICETRACKER_API_KEY` y set **sin `pptSetId`**, causas #4 y #5 del mapa
   * (`BACKEND_NOTES.md` §0.16.2)— mandaba al operador a leer las líneas «PPT graded: EL REQUEST
   * FALLÓ»… que en esos dos casos **no existen**, porque el `return` ocurre ANTES de llamar. Es el
   * defecto (b) de R1 repetido, y en la causa que hoy más se sospecha de las cartas sin dato.
   *
   * El orquestador lo acumula (`GradedRequestTally`) y el veredicto manda a la línea que SÍ existe.
   */
  noRequestReason: 'missing_api_key' | 'set_without_ppt_set_id' | null;
  /**
   * v1.51-b (TL-GE1) — **COSTE ATRIBUIBLE a las llamadas graded de ESTE set**: la suma de
   * `metadata.apiCallsConsumed` de sus respuestas. `null` = alguna respuesta no lo reportó ⇒ el gasto
   * NO es atribuible y **no se reporta ningún número**.
   *
   * ### Por qué NO se usa el contador diario
   * Aquí vivían `dailyRemainingBefore`/`dailyRemaining`, y la resta se presentaba como «COSTE MEDIDO».
   * Pero ese contador es `PptApiClient.lastDailyRemaining`: **estado del singleton del proceso**, que
   * pisa CUALQUIER respuesta de PPT — incluida la del barrido de precios RAW, que corre justo antes en
   * la misma corrida (y, con Redis, en workers del mismo proceso). La resta le cobraba a esta sonda
   * créditos ajenos, y con el umbral de `>= 0.5 crédito/carta` eso podía disparar una escalada de
   * PRESUPUESTO falsa. Como la cifra es precondición del primer `off → on` (§4.38r.3.1.1), tiene que
   * ser real o no estar: se prefiere una línea que diga «no se pudo aislar» a un número contaminado.
   */
  gradedApiCallsConsumed: number | null;
  /**
   * v1.50.3-c (techlead) — **qué le PEDIMOS mirar al proveedor en esta llamada**
   * (`POKEMONPRICETRACKER_GRADED_FORMAT`: `auto` | `sales_by_grade` | `graded_prices`).
   *
   * Viaja con el resultado porque `shapeCounts` **no es interpretable sin él**: con `graded_prices`
   * forzado, `parseGradedEntry` pone `useS1 = false` por decreto del operador, así que TODA carta con
   * bloque `gradedPrices` se cuenta como S2 y el conteo deja de decir «esto sirve PPT» para decir
   * «esto es lo que le pedimos». Un veredicto de arquitectura y presupuesto no puede sostenerse sobre
   * un conteo que nosotros mismos inducimos (misma clase de falso positivo que el 401/403 leído como
   * «no admite el parámetro»), y §4.38h.1-bis declara ese forzado explícitamente LEGAL.
   */
  forcedFormat: GradedFormat;
}

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
          sample = truncate(JSON.stringify(entries[0]), GRADED_SAMPLE_TRUNCATE);
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

  // ==========================================================================================
  // v1.50.2 (§4.38h) — INGEST AUTOMÁTICO DE ESTIMADOS PSA. Parser AUTO-CONFIRMANTE.
  // ==========================================================================================

  /**
   * Barre UN set pidiendo además el bloque de eBay (`includeEbay=true`) y devuelve **solo** los
   * estimados PSA que el parser identifica **POSITIVAMENTE** como monto.
   *
   * ### Por qué esto NO viola la doctrina P-6 — la satisface por construcción
   * P-6 prohíbe **codificar contra un esquema que se ASUME**. La documentación del proveedor se
   * **contradice** entre `data[i].ebay.salesByGrade.psaN` (objeto) y `gradedPrices.psaN` (escalar), y
   * v1.50 concluyó de ahí «fase 2 BLOQUEADA, captura manual». El humano cuestionó ese bloqueo y tenía
   * razón: lo que P-6 exige no es *no automatizar*, es **no asumir**. Este parser **prueba las dos
   * hipótesis en orden fijo**, y ante **cualquier otra forma NO ESCRIBE NADA** y registra la muestra
   * cruda. La primera corrida real **confirma el formato con cero datos malos en la BD**, que es
   * exactamente lo que P-6 protege. Nunca hay fallback silencioso entre shapes.
   *
   * | | Ruta | Persiste SOLO si |
   * |---|---|---|
   * | **S1** | `ebay.salesByGrade.psaN` (objeto) | el stat elegido es número finito **> 0**, Y `count` entero **>= minSampleCount**, Y la **evidencia** (`lastSaleDate`) se identifica positivamente y cae dentro de `freshnessDays` |
   * | **S2** | `gradedPrices.psaN` (escalar) | **NUNCA** — declarado **NO PERSISTIBLE** (§4.38h.1-bis). Se **detecta** y se **registra**; no se escribe |
   * | **—** | cualquier otra (array, string, null, NaN, negativo, objeto desconocido) | **NADA** + muestra cruda |
   *
   * ### v1.50.3-a (§4.38h.1-bis) — S2 es NO PERSISTIBLE, y por qué el sondeo se conserva igual
   * El gate de confianza de §O.7 tiene tres pruebas —**fresca**, **origen confiable**, **coherente en
   * magnitud**— y solo la tercera se calcula con datos NUESTROS. Las otras dos se calculan con
   * **evidencia del proveedor**: `count` y fecha de la última venta. Un escalar pelado **no trae
   * ninguna de las dos**: no es que no las hayamos leído, es que **el shape no las contiene**. Por eso
   * S2 no es «un S1 degradado» sino un objeto epistemológico distinto, **estructuralmente incapaz** de
   * satisfacer las pruebas 1 y 2 — y no hay ninguna superficie (ni siquiera la ficha, que es más
   * permisiva en MAGNITUD, no en procedencia) donde una fila S2 sería admisible. Persistirla produciría
   * basura en una tabla de dinero a cambio de cero valor.
   *
   * **La escotilla `POKEMONPRICETRACKER_GRADED_MIN_COUNT=0` queda DEROGADA y se RETIRA** (no se
   * sustituye por otra): su único propósito declarado era hacer persistible a S2, y detrás del gate de
   * evidencia ya no abre nada. Una escotilla que no abre nada **es peor que no tenerla** — alguien la
   * pondrá, no verá cambio alguno y concluirá que el ingest está roto: el mismo falso negativo de
   * diagnóstico que producía el truncate de 800 chars. Para admitir muestras pequeñas en S1 la vía
   * correcta existe y es un dial **auditado**: `graded_estimate_min_sample_count = 1`.
   *
   * **El sondeo de S2 se conserva con papel NUEVO: diagnóstico, no escritura.** Encontrar S2 es la
   * señal de que el proveedor no está dando lo que la fase 2 necesita, y esa señal tiene que llegar a
   * un humano en vez de disolverse en un contador de «saltadas» ⇒ motivo propio
   * `shape_not_persistible_s2` + `shapeCounts`, contados APARTE.
   *
   * - **El override del operador MANDA sobre la autodetección.** Con `POKEMONPRICETRACKER_GRADED_FORMAT`
   *   / `_GRADED_FIELD` fijados, si la respuesta no casa **no se escribe nada** y se registra la
   *   muestra: caer al otro shape derrotaría la intención explícita que el override existe para
   *   expresar.
   * - **MONEDA (INV-FX, §4.38a):** el formato sale del MISMO candado fail-closed que el market
   *   (`POKEMONPRICETRACKER_GRADED_MARKET_FORMAT` y, si no está, `POKEMONPRICETRACKER_MARKET_FORMAT` —
   *   mismo proveedor, misma convención, confirmada por el PO: `usd_dollars`). **Sin formato explícito
   *   NO se persiste nada**: es la misma doctrina que ya rige el market, y evita que este camino
   *   invente una unidad por su cuenta.
   */
  async fetchGradedEstimatesForSet(input: {
    set: { externalId: string };
    providerSetId: string | null;
    /** Grados a leer (de la config: `["10","9"]`). */
    grades: readonly string[];
    /** `graded_estimate_min_sample_count` — se aplica AQUÍ, en la ESCRITURA (§4.38k.1). */
    minSampleCount: number;
    /** `graded_estimate_source_stat` — cuál número del proveedor ES el precio. */
    sourceStat: GradedStat;
    /**
     * v1.50.3 (§4.38m.2) — GATE DE EVIDENCIA: ventana máxima, en días, de la **última venta observada**.
     * Es `graded_estimate_freshness_days`, el MISMO dial que la lectura, aplicado en la ESCRITURA.
     */
    freshnessDays: number;
    /** Fecha de negocio (`YYYY-MM-DD`) contra la que se mide la evidencia. */
    today: string;
  }): Promise<GradedEstimateFetchResult> {
    const empty: GradedEstimateFetchResult = {
      rows: [],
      fetchedRaw: 0,
      drops: [],
      requestOk: false,
      dailyLimited: false,
      dailyRemaining: this.client.dailyRemaining(),
      // Sin llamada no hay gasto: 0 es un dato ATRIBUIBLE y exacto, no una estimación.
      gradedApiCallsConsumed: 0,
      // `probe` describe si ESTA llamada pudo escribir. En `empty` no hubo llamada siquiera (sin key,
      // sin pptSetId): no es una sonda, es un no-op — y decir lo contrario contaminaría el veredicto.
      probe: false,
      // R1-ter: `empty` se usa TAMBIÉN como base del rechazo de parámetro (donde SÍ hubo petición), así
      // que el default es `null` = «hubo intento» y cada `return empty` sin llamada declara su motivo.
      noRequestReason: null,
      escalate: null,
      sawGradedBlock: false,
      shapeCounts: { s1: 0, s2: 0 },
      forcedFormat: this.gradedFormatOverride(),
    };
    if (!this.client.apiKey()) {
      this.logger.warn('PPT graded: falta POKEMONPRICETRACKER_API_KEY → no se ingesta (nada se escribe).');
      return { ...empty, noRequestReason: 'missing_api_key' };
    }
    if (!input.providerSetId) {
      this.logger.warn(
        `PPT graded: set ${input.set.externalId} sin pptSetId → no se pide nada (jamás se cae al externalId).`,
      );
      return { ...empty, noRequestReason: 'set_without_ppt_set_id' };
    }
    // ── v1.50.3-g (§4.38h.1-quater) — LA SONDA: sin formato NO se escribe, pero SÍ se PREGUNTA ──────
    //
    // Aquí vivía un `return empty` **antes** del bucle de fetch: el modo se llamaba «SAMPLE-ONLY» y su
    // propio warn mandaba «inspecciona el log»… de una petición que ese mismo `return` impedía hacer.
    // Era un no-op con nombre de diagnóstico: sin llamada, sin muestra, sin log, y por tanto **sin
    // manera de saber qué sirve el proveedor** — justo el dato que la fase 2 necesita para existir.
    //
    // El camino de precios RAW (`fetchSingleSweep`) ya lo hacía bien y es el patrón que se copia:
    // pide la página, **loguea la muestra cruda** y solo ENTONCES corta sin persistir. Eso es lo que
    // P-6 pedía —«no construir un parser sobre un esquema no confirmado»—: la doctrina prohíbe
    // **asumir** el esquema, no **observarlo**; observarlo es literalmente el remedio.
    //
    // La sonda es de SOLO LECTURA por CONSTRUCCIÓN, no por disciplina: cuando `writeFormat == null` el
    // bucle ni siquiera llama a `parseGradedEntry` (el único código capaz de fabricar una
    // `GradedEstimateSourceRow`), sino a `detectGradedShape`, cuyo tipo de retorno **no contiene filas**.
    // No hay rama, dial ni env que pueda hacer que la sonda escriba: para escribir habría que cambiar
    // el tipo. S2 sigue NO PERSISTIBLE (§4.38h.1-bis) y la sonda **tampoco lo relaja**: detecta y reporta.
    const configuredFormat =
      parseMarketFormat(this.config.get<string>('POKEMONPRICETRACKER_GRADED_MARKET_FORMAT')) ??
      parseMarketFormat(this.config.get<string>('POKEMONPRICETRACKER_MARKET_FORMAT'));
    const probeRequested = this.gradedProbeRequested();
    // `writeFormat == null` ⇔ SONDA. Dos entradas al mismo modo, y las dos fail-closed:
    //  (1) NO hay formato de moneda ⇒ no se puede persistir dinero (candado histórico, se conserva);
    //  (2) el operador PIDE la sonda (`POKEMONPRICETRACKER_GRADED_PROBE=on`) aunque el formato esté
    //      fijado — es la 1ª corrida contra el proveedor real: se mira ANTES de escribir. Hace falta
    //      porque el formato del graded se HEREDA de `POKEMONPRICETRACKER_MARKET_FORMAT`, que ya está
    //      puesto para los precios raw: sin este interruptor, «observar primero» exigiría apagar los
    //      precios de todo el catálogo.
    const writeFormat: MarketFormat | null = probeRequested ? null : configuredFormat;
    if (writeFormat == null) {
      this.logger.warn(
        probeRequested
          ? 'PPT graded: SONDA pedida por el operador (POKEMONPRICETRACKER_GRADED_PROBE) → se CONSULTA ' +
            'al proveedor, se LOGUEA la muestra cruda y NO se escribe absolutamente nada (cero filas ' +
            'en PriceReference). Quita la env para que la corrida vuelva a ingestar.'
          : 'PPT graded: sin POKEMONPRICETRACKER_MARKET_FORMAT (ni _GRADED_MARKET_FORMAT) → SONDA de ' +
            'SOLO LECTURA: se consulta al proveedor y se loguea la muestra cruda, pero NO se persiste ' +
            'ningún estimado (sin moneda declarada no se escribe dinero). Fija el formato tras leer el log.',
      );
    }

    const forcedFormat = this.gradedFormatOverride();
    const forcedField = this.gradedFieldOverride();
    const stat: GradedStat = forcedField ?? input.sourceStat;

    const rows: GradedEstimateSourceRow[] = [];
    const drops: GradedDropSample[] = [];
    let fetchedRaw = 0;
    let requestOk = false;
    let dailyLimited = false;
    let sawGradedBlock = false;
    const shapeCounts = { s1: 0, s2: 0 };
    let sample: string | null = null;
    /** Muestras CRUDAS del bloque de grados que la sonda encontró (las que contestan la pregunta). */
    const probeBlocks: string[] = [];
    // COSTE MEDIDO, no supuesto (§4.38h.5) y sobre todo **ATRIBUIBLE** (v1.51-b, TL-GE1). El diseño
    // afirma que el coste es «proporcional al inventario real», pero la petición manda
    // `fetchAllInSet=true` (= el SET entero). Si PPT cobra por carta DEVUELTA, la premisa es falsa.
    //
    // Se suma `metadata.apiCallsConsumed` de CADA respuesta graded — el único número que habla de
    // ESTAS llamadas. La versión anterior restaba el contador diario del cliente (`dailyRemaining`
    // antes/después), que es estado compartido del proceso: el barrido de precios RAW corre en la
    // misma corrida y lo pisa, así que la resta le cobraba a la sonda créditos ajenos. Si alguna
    // respuesta no trae el campo, el total deja de ser atribuible y se reporta `null` (sin número).
    let gradedApiCalls = 0;
    let gradedCostIsolated = true;

    try {
      let received = 0;
      let offset: number | null = null;
      for (let page = 0; page < this.maxPages; page++) {
        const { entries, pagination, url, dailyRemaining, apiCallsConsumed } = await this.fetchGradedPage(
          input.providerSetId,
          offset,
        );
        requestOk = true;
        // El coste se acumula ANTES de cualquier `break`: una página que se pagó cuenta aunque su
        // contenido no sirva. Una sola página sin el campo invalida la ATRIBUCIÓN del set entero — no
        // se completa con el contador diario, que es justo el dato contaminado que se retiró.
        if (apiCallsConsumed == null) gradedCostIsolated = false;
        else gradedApiCalls += apiCallsConsumed;
        if (entries.length === 0) break;
        received += entries.length;
        fetchedRaw += entries.length;
        if (sample == null) {
          sample = truncate(JSON.stringify(entries[0]), GRADED_SAMPLE_TRUNCATE);
          this.logger.log(
            `PPT graded: GET ${url} OK (set ${input.set.externalId}=${input.providerSetId}, pág ${page + 1}): ` +
              `${entries.length} entradas, pagination=${JSON.stringify(pagination)}, ` +
              `dailyRemaining=${dailyRemaining ?? 'n/d'}. Ejemplo crudo (${GRADED_SAMPLE_TRUNCATE} chars): ${sample}`,
          );
        }
        for (const entry of entries) {
          // ── SONDA (solo lectura). `detectGradedShape` NO devuelve filas: no hay nada que persistir.
          if (writeFormat == null) {
            const seen = detectGradedShape(entry);
            if (seen.sawGradedBlock) sawGradedBlock = true;
            if (seen.shape === 's1') shapeCounts.s1 += 1;
            else if (seen.shape === 's2') shapeCounts.s2 += 1;
            if (seen.blockSample && probeBlocks.length < GRADED_PROBE_MAX_BLOCK_SAMPLES) {
              probeBlocks.push(`${seen.externalId ?? 'n/d'} → ${seen.blockSample}`);
            }
            continue;
          }
          const parsed = this.parseGradedEntry(entry, {
            grades: input.grades,
            stat,
            forcedFormat,
            minSampleCount: input.minSampleCount,
            format: writeFormat,
            evidenceField: this.gradedEvidenceField(),
            freshnessDays: input.freshnessDays,
            today: input.today,
          });
          if (parsed.sawGradedBlock) sawGradedBlock = true;
          if (parsed.shape === 's1') shapeCounts.s1 += 1;
          else if (parsed.shape === 's2') shapeCounts.s2 += 1;
          rows.push(...parsed.rows);
          drops.push(...parsed.drops);
        }
        // ACOTA EL GASTO (§4.38h.5): la sonda se queda con la PRIMERA página. Su pregunta —«¿qué shape
        // sirve PPT?»— la contesta la primera respuesta; paginar el set entero solo compraría más
        // copias de la misma respuesta con el crédito del dueño.
        if (writeFormat == null) break;
        if (!this.hasMorePages(pagination, received)) break;
        offset = received;
      }
    } catch (e) {
      if (e instanceof PptDailyLimitError) {
        dailyLimited = true;
        this.logger.warn(`PPT graded: 429 DAILY en el set ${input.set.externalId} → PARADA. ${e.message}`);
      } else if (e instanceof PptHttpError && isParamRejection(e.status)) {
        // ⛔ ESCALADA: el proveedor RECHAZA la combinación `includeEbay=true` + `fetchAllInSet=true`.
        // NO se cae a «una petición por carta»: eso cambia el modelo de coste (2 créditos × carta) y
        // el de barrido, y es decisión del ARQUITECTO (regla 9), no un fallback de implementación.
        return {
          ...empty,
          requestOk: false,
          // Lo ya pagado antes del rechazo sigue contando (o `null` si no era atribuible): el `empty`
          // de arriba dice 0 porque describe el caso «no hubo llamada», que aquí no aplica.
          gradedApiCallsConsumed: gradedCostIsolated ? gradedApiCalls : null,
          escalate: {
            reason: 'ebay_not_supported_with_set_sweep',
            detail:
              `HTTP ${e.status} al pedir includeEbay=true junto con fetchAllInSet=true ` +
              `(set ${input.set.externalId}): ${e.message}`,
          },
        };
      } else {
        // Incluye 401/403 (credencial) y 404 (`pptSetId` que ya no existe): fallo de request NORMAL,
        // NO una escalada. El diagnóstico va en el log para que se actúe sobre la causa real.
        const status = e instanceof PptHttpError ? e.status : null;
        const pista =
          status === 401 || status === 403
            ? ' → revisa POKEMONPRICETRACKER_API_KEY (ausente, vencida o sin el plan que incluye eBay).'
            : status === 404
              ? ` → el pptSetId cacheado del set ${input.set.externalId} ya no existe en el proveedor; re-mapéalo.`
              : '';
        this.logger.warn(
          `PPT graded: EL REQUEST FALLÓ para el set ${input.set.externalId}: ${(e as Error).message} ` +
            `(no se escribe nada; los estimados previos quedan intactos).${pista}`,
        );
      }
    }

    // ⚠️ CANDIDATO A ESCALADA (2ª forma, la silenciosa): el request PASÓ pero NINGUNA entrada de ESTE
    // set trae bloque de grados. Aisladamente no podemos distinguir «este set no tiene ventas PSA» de
    // «el proveedor IGNORÓ includeEbay», y adivinar entre esas dos es lo que P-6 prohíbe.
    //
    // ⚠️ **Es un candidato, no un veredicto** (v1.50.2, techlead). El proveedor solo ve UN set, así que
    // esto es lo máximo que puede afirmar; quien decide si hay que escalar es el ORQUESTADOR
    // (`PriceIngestService.ingestGradedEstimates`), que ve la CORRIDA entera y usa `sawGradedBlock`:
    // si algún set del run vio el bloque, el shape está confirmado y éste es un set sin ventas PSA —un
    // estado de datos perfectamente normal— que se salta con traza. Solo cuando NINGÚN set lo vio la
    // hipótesis «ignoró el parámetro» es de verdad indistinguible, y ahí sí se escala.
    const escalate =
      requestOk && fetchedRaw > 0 && !sawGradedBlock
        ? {
            reason: 'no_graded_block_in_response' as const,
            detail:
              `El barrido del set ${input.set.externalId} devolvió ${fetchedRaw} entradas con ` +
              'includeEbay=true y NINGUNA trae bloque PSA reconocible. Muestra cruda: ' +
              `${sample ?? 'n/d'}`,
          }
        : null;

    // Reporte de la SONDA, por set: lo que se fue a averiguar, junto y en una línea grepeable. El
    // veredicto de la CORRIDA lo emite el orquestador (`PriceIngestService`), que ve todos los sets.
    if (writeFormat == null && requestOk) {
      this.logger.warn(
        `${GRADED_PROBE_TAG} set=${input.set.externalId} (pptSetId=${input.providerSetId}): ` +
          `${fetchedRaw} carta(s) devueltas, ${shapeCounts.s1} con S1 (ebay.salesByGrade, PERSISTIBLE) / ` +
          `${shapeCounts.s2} con S2 (gradedPrices escalar, NO persistible) / ` +
          `${fetchedRaw - shapeCounts.s1 - shapeCounts.s2} sin bloque PSA. ` +
          // TL-GE1: SOLO el gasto atribuible a estas llamadas. Antes se imprimía la resta del contador
          // diario, que el barrido RAW de la misma corrida contamina: un Δ prestado, presentado como
          // medición, gobernando una decisión de presupuesto.
          `Créditos ATRIBUIBLES a estas llamadas (metadata.apiCallsConsumed): ${
            gradedCostIsolated
              ? gradedApiCalls
              : 'NO SE PUDO AISLAR (el proveedor no lo reportó en alguna respuesta; el contador diario NO ' +
                'sirve: lo pisa el barrido de precios RAW de esta misma corrida)'
          }. ` +
          'ESCRITURAS: 0 (la sonda no puede escribir: no construye filas). ' +
          `Bloques crudos: ${probeBlocks.length > 0 ? probeBlocks.join(' | ') : `ninguno; entrada cruda: ${sample ?? 'n/d'}`}`,
      );
    }

    return {
      rows,
      fetchedRaw,
      drops,
      requestOk,
      dailyLimited,
      dailyRemaining: this.client.dailyRemaining(),
      gradedApiCallsConsumed: gradedCostIsolated ? gradedApiCalls : null,
      probe: writeFormat == null,
      // R1-ter: se llegó al bucle de fetch ⇒ HUBO petición (respondiera OK o no). Las líneas «EL
      // REQUEST FALLÓ» existen en el log de esta corrida si algo falló, así que el veredicto puede
      // mandar a leerlas.
      noRequestReason: null,
      escalate,
      sawGradedBlock,
      shapeCounts,
      forcedFormat,
    };
  }

  /**
   * v1.50.3-g (§4.38h.1-quater) — `POKEMONPRICETRACKER_GRADED_PROBE`: **modo sonda a petición**.
   *
   * Existe porque el formato del graded se HEREDA de `POKEMONPRICETRACKER_MARKET_FORMAT`, que ya está
   * fijado para los precios raw. Sin este interruptor, «mirar antes de escribir» obligaría a apagar el
   * formato de TODO el catálogo — un remedio peor que la enfermedad, y la clase de fricción que hace
   * que nadie observe y todos asuman (exactamente lo que P-6 quiere evitar).
   *
   * Sentido ÚNICO y fail-closed: solo puede **quitar** capacidad de escritura, nunca darla. No hay
   * valor de esta env que haga persistir algo que hoy no persiste.
   *
   * ### v1.51-b (TL-GE3) — un valor no reconocido AVISA; ya no cae en silencio
   * La SEMÁNTICA no cambia: la sonda se enciende **solo** con `on|true|1|yes`, y cualquier otra cosa
   * la deja apagada (o sea, la corrida ESCRIBE). Lo que cambia es que un `POKEMONPRICETRACKER_GRADED_PROBE=onn`
   * ya no se traga el typo: su hermana de nueve líneas más abajo (`gradedFormatOverride`) sí avisaba, y
   * la asimetría era del peor signo — ésta falla hacia el lado que GASTA y ESCRIBE, así que su silencio
   * costaba créditos y filas de dinero que el operador creía haber impedido.
   */
  private gradedProbeRequested(): boolean {
    const raw = this.config.get<string>('POKEMONPRICETRACKER_GRADED_PROBE');
    const v = raw?.trim().toLowerCase();
    if (v == null || v === '') return false; // AUSENTE: el estado normal, no hay nada que avisar.
    if (v === 'on' || v === 'true' || v === '1' || v === 'yes') return true;
    // Negativos EXPLÍCITOS: son la forma natural de escribir «no» (y `off` es la pareja obvia de `on`).
    // Devuelven lo mismo que cualquier otro valor —false—; se listan solo para no gritar por un valor
    // que el operador escribió a propósito.
    if (v === 'off' || v === 'false' || v === '0' || v === 'no') return false;
    this.logger.warn(
      `PPT graded: POKEMONPRICETRACKER_GRADED_PROBE="${raw}" no es on|true|1|yes (ni off|false|0|no) → ` +
        'la SONDA queda APAGADA y la corrida SÍ pedirá y SÍ escribirá. Si querías observar sin escribir, ' +
        'corrige el valor a `on`.',
    );
    return false;
  }

  /** `POKEMONPRICETRACKER_GRADED_FORMAT` (`auto` default). Valor desconocido ⇒ `auto` + `warn`. */
  private gradedFormatOverride(): GradedFormat {
    const raw = this.config.get<string>('POKEMONPRICETRACKER_GRADED_FORMAT');
    if (raw == null || raw.trim() === '') return 'auto';
    const v = raw.trim().toLowerCase() as GradedFormat;
    if (GRADED_FORMATS.includes(v)) return v;
    this.logger.warn(
      `PPT graded: POKEMONPRICETRACKER_GRADED_FORMAT="${raw}" no es ${GRADED_FORMATS.join('|')} → se usa auto.`,
    );
    return 'auto';
  }

  /**
   * `POKEMONPRICETRACKER_GRADED_EVIDENCE_FIELD` — nombre del campo de la ÚLTIMA VENTA dentro del bloque
   * S1 (§4.38m.2). Existe como env y no como constante porque es el único dato del gate cuyo NOMBRE
   * depende del proveedor: si PPT lo llama distinto, el operador lo corrige **sin deploy** en vez de
   * quedarse con el ingest escribiendo cero filas y sin saber por qué. **No se sondean alias a ciegas**
   * (P-6): el drop `evidence_unknown` lleva el nombre del campo buscado en su muestra cruda, que es lo
   * que permite descubrir el nombre real mirando la traza.
   */
  private gradedEvidenceField(): string {
    const raw = this.config.get<string>('POKEMONPRICETRACKER_GRADED_EVIDENCE_FIELD');
    const v = raw?.trim();
    return v ? v : GRADED_EVIDENCE_FIELD_DEFAULT;
  }

  /** `POKEMONPRICETRACKER_GRADED_FIELD` — override del operador sobre el dial `sourceStat`. */
  private gradedFieldOverride(): GradedStat | null {
    const raw = this.config.get<string>('POKEMONPRICETRACKER_GRADED_FIELD');
    if (raw == null || raw.trim() === '') return null;
    const v = raw.trim();
    for (const [stat, field] of Object.entries(GRADED_STAT_FIELD)) {
      if (v === field || v === stat) return stat as GradedStat;
    }
    this.logger.warn(
      `PPT graded: POKEMONPRICETRACKER_GRADED_FIELD="${raw}" desconocido → se usa el dial sourceStat.`,
    );
    return null;
  }

  /**
   * El SONDEO, por entrada. Devuelve filas SOLO con identificación positiva; ante cualquier otra forma,
   * un `drop` con la muestra cruda y **cero escrituras**.
   *
   * `shape` dice **qué hipótesis casó** en esta entrada (`null` = ninguna). Sirve para contar por CARTA
   * cuánto sirve el proveedor de cada shape (§4.38h.1-bis), que es el insumo de la escalada de corrida.
   */
  private parseGradedEntry(
    entry: unknown,
    opts: {
      grades: readonly string[];
      stat: GradedStat;
      forcedFormat: GradedFormat;
      minSampleCount: number;
      format: MarketFormat;
      /** v1.50.3 (§4.38m.2) — nombre del campo de la última venta dentro del bloque S1. */
      evidenceField: string;
      freshnessDays: number;
      today: string;
    },
  ): {
    rows: GradedEstimateSourceRow[];
    drops: GradedDropSample[];
    sawGradedBlock: boolean;
    shape: 's1' | 's2' | null;
  } {
    const out = {
      rows: [] as GradedEstimateSourceRow[],
      drops: [] as GradedDropSample[],
      sawGradedBlock: false,
      shape: null as 's1' | 's2' | null,
    };
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return out;
    const e = entry as Record<string, unknown>;
    const externalId = firstString(e, ['id', 'cardId']);
    const number = firstString(e, ['cardNumber', 'number', 'collectorNumber']);

    // S1: `ebay.salesByGrade.psaN` (objeto con count/medianPrice/…).
    const salesByGrade = pickObject(pickObject(e['ebay']), 'salesByGrade');
    // S2: `gradedPrices.psaN` (escalar).
    const gradedPrices = pickObject(e, 'gradedPrices');
    const useS1 = opts.forcedFormat !== 'graded_prices' && salesByGrade != null;
    const useS2 = opts.forcedFormat !== 'sales_by_grade' && !useS1 && gradedPrices != null;
    if (salesByGrade != null || gradedPrices != null) out.sawGradedBlock = true;
    if (!useS1 && !useS2) {
      // Con override fijado y respuesta que NO casa, esto es lo correcto: NO escribir y dejar traza.
      if (opts.forcedFormat !== 'auto' && (salesByGrade != null || gradedPrices != null)) {
        out.drops.push({
          externalId,
          reason: 'unrecognized_shape',
          count: null,
          sample: truncate(JSON.stringify(e['ebay'] ?? e['gradedPrices'] ?? null), GRADED_SAMPLE_TRUNCATE),
        });
      }
      return out;
    }
    out.shape = useS1 ? 's1' : 's2';

    // ======= (§4.38h.1-bis) S2 — NO PERSISTIBLE. Se DETECTA, se REGISTRA y se sale. =======
    //
    // Una traza POR CARTA (no por grado): la pregunta que este motivo contesta es «¿qué está sirviendo
    // el proveedor?», y esa pregunta es de la ENTRADA, no de cada `psaN` que traiga.
    //
    // No se evalúa el monto, ni el `count`, ni la evidencia — **no porque fallen, sino porque no
    // existen**: el shape escalar no contiene las dos piezas de evidencia (muestra y fecha) que las
    // pruebas 1 y 2 del gate de confianza necesitan. Correr los gates aquí solo produciría un motivo
    // EQUIVOCADO (`sample_too_small` / `evidence_unknown`), que es justo la confusión que (h.1-bis)
    // manda eliminar: haría indistinguible «el proveedor cambió de shape» —que se escala— de «esta
    // carta tiene pocas ventas» —que no se hace nada—.
    if (useS2) {
      out.drops.push({
        externalId,
        reason: 'shape_not_persistible_s2',
        count: null,
        sample: truncate(JSON.stringify({ gradedPrices }), GRADED_SAMPLE_TRUNCATE),
      });
      return out;
    }

    for (const grade of opts.grades) {
      const key = `psa${grade}`;
      const raw = (salesByGrade as Record<string, unknown>)[key];
      if (raw === undefined) continue; // el grado sencillamente no viene: no es un error, se OMITE.

      // S1 EXIGE objeto. Un escalar aquí NO se acepta «por tolerancia»: sería asumir que el número
      // suelto es el stat que pedimos, que es justo la clase de suposición que P-6 prohíbe.
      if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        out.drops.push({
          externalId,
          reason: 'unrecognized_shape',
          count: null,
          sample: truncate(JSON.stringify({ [key]: raw }), GRADED_SAMPLE_TRUNCATE),
        });
        continue;
      }
      const o = raw as Record<string, unknown>;
      const statValue = o[GRADED_STAT_FIELD[opts.stat]];
      const amount = typeof statValue === 'number' && Number.isFinite(statValue) ? statValue : null;
      const c = o['count'];
      const count = typeof c === 'number' && Number.isInteger(c) && Number.isFinite(c) ? c : null;
      const evidenceRaw = o[opts.evidenceField];

      const amountCents = toCents(amount, opts.format.unit);
      if (amountCents == null) {
        out.drops.push({
          externalId,
          reason: amount == null ? 'unrecognized_shape' : 'not_a_positive_amount',
          count,
          sample: truncate(JSON.stringify({ [key]: raw }), GRADED_SAMPLE_TRUNCATE),
        });
        continue;
      }
      // Gate de ORIGEN CONFIABLE (§4.38k, punto 2) — aplicado en la ESCRITURA. `null` = DESCONOCIDO
      // (el objeto S1 no trajo `count`, o lo trajo con una forma que no es un entero), y «desconocido»
      // NO es «suficiente»: **fail-closed sin excepción**.
      //
      // ⚠️ v1.50.3-a (§4.38h.1-bis) — aquí vivía la escotilla `POKEMONPRICETRACKER_GRADED_MIN_COUNT=0`.
      // Se RETIRA y no se sustituye: su único propósito era hacer persistible a S2, que ahora está
      // declarado NO PERSISTIBLE por shape. Para admitir muestras pequeñas en S1 la vía es el dial
      // AUDITADO `graded_estimate_min_sample_count = 1`, que llega hasta aquí como `minSampleCount`.
      if (count == null || count < opts.minSampleCount) {
        out.drops.push({
          externalId,
          reason: 'sample_too_small',
          count,
          sample: truncate(JSON.stringify({ [key]: raw }), GRADED_SAMPLE_TRUNCATE),
        });
        continue;
      }
      // ============ GATE DE EVIDENCIA (v1.50.3, §4.38m.2) — la OTRA mitad del criterio 109 ============
      //
      // El criterio 109 y §O.7 miden la frescura del dato automático contra «la antigüedad de la
      // EVIDENCIA de mercado, **no la fecha en que jalamos el archivo**». Nuestro `stale()` de lectura
      // mide contra `capturedDate`, que para una fila del ingest ES la fecha en que jalamos el archivo.
      //
      // El fallo que eso abre: el proveedor deja de recibir ventas de la carta pero **sigue sirviendo la
      // misma mediana**; cada corrida reescribe la fila con `capturedDate = hoy` ⇒ **la cifra parece
      // fresca para siempre**. Es el feed rancio disfrazado de fresco por nuestro propio job — justo lo
      // que el dial existía para impedir.
      //
      // Se cierra SIN DDL, con la misma técnica que `minSampleCount`: **gatear en la ESCRITURA**. Una
      // fila solo puede refrescar su `capturedDate` mientras su evidencia esté fresca; en cuanto la
      // evidencia envejece, el ingest deja de reescribirla, `capturedDate` se CONGELA y la regla de
      // lectura la vence dentro de `freshnessDays`.
      //
      // ⚠️ Cota HONESTA y declarada: la antigüedad máxima de la evidencia exhibida es
      // `freshnessDays` (al escribir) + `freshnessDays` (desde esa escritura) = **≤ 2× freshnessDays**
      // (60 d con el seed), NO los 30 literales del criterio. Es una aproximación conservadora en la
      // dirección correcta —cierra el «fresco para siempre», que era el fallo grave— pero **no es el
      // criterio al pie de la letra**; el cierre exacto es la columna `evidenceDate`, que M-43
      // (v1.50.3-f) YA creó pero que **este pase no cablea** (ni escritor ni `stale()`): sigue viva la
      // aproximación de arriba. Ver `TECH_DEBT.md`.
      //
      // ⚠️ v1.50.3-a — **la fecha es una HIPÓTESIS, no un hecho, y se trata como tal.** El Gate 0 dejó
      // escrito que la documentación del proveedor **se contradice a sí misma** sobre la forma del
      // bloque PSA; `PROJECT.md` §O.6 describe `salesByGrade` con «fecha de la última venta», pero eso
      // es **documentación del proveedor, no una respuesta observada**. Por eso el parser NO asume el
      // nombre ni el formato del campo: lo **identifica positivamente** (`parseEvidenceDate`) o no
      // escribe, exactamente igual que hace con el stat. Un S1 **sin** fecha no es «S1 degradado»: es
      // una forma que no sabemos leer. Sería incoherente auto-confirmar el precio y **dar por supuesta
      // la fecha** — eso es P-6 aplicada al campo nuevo.
      const evidenceDate = parseEvidenceDate(evidenceRaw);
      if (evidenceDate == null) {
        // «Desconocido» NO es «fresco» — misma doctrina fail-closed que el `count` ausente: se registra
        // la muestra (con el NOMBRE del campo buscado) y no se escribe dinero.
        out.drops.push({
          externalId,
          reason: 'evidence_unknown',
          count,
          sample: truncate(JSON.stringify({ [key]: raw, evidenceField: opts.evidenceField }), GRADED_SAMPLE_TRUNCATE),
        });
        continue;
      }
      if (isStaleEstimate(evidenceDate, opts.today, opts.freshnessDays)) {
        out.drops.push({
          externalId,
          reason: 'evidence_too_old',
          count,
          sample: truncate(JSON.stringify({ [key]: raw, evidenceDate }), GRADED_SAMPLE_TRUNCATE),
        });
        continue;
      }

      out.rows.push({
        externalId,
        number,
        gradeValue: grade,
        amountCents,
        currency: opts.format.currency,
        count,
        evidenceDate,
        source: this.source,
      });
    }
    return out;
  }

  /**
   * GET de una página del barrido CON `includeEbay=true` (2 créditos/carta, §4.38h). Se pide junto a
   * `fetchAllInSet=true` **a propósito**: si el proveedor no admitiera la combinación, el modelo de
   * coste cambia por completo y eso ESCALA al arquitecto — no se degrada a una petición por carta.
   */
  private async fetchGradedPage(providerSetId: string, offset: number | null): Promise<PricesPage> {
    const query: Record<string, string> = {
      setId: providerSetId,
      fetchAllInSet: 'true',
      includeEbay: 'true',
    };
    if (offset != null) {
      query.limit = String(this.pageLimit);
      query.offset = String(offset);
    }
    const res: PptResponse<unknown> = await this.client.getJson<unknown>(this.cardsPath, query);
    return {
      entries: this.extractEntries(res.body),
      pagination: this.extractPagination(res.body),
      url: res.url,
      dailyRemaining: res.dailyRemaining,
      apiCallsConsumed: res.apiCallsConsumed,
    };
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
      apiCallsConsumed: res.apiCallsConsumed,
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

/** Sub-objeto PLANO (no array, no null) de `o[key]`, o `null`. Nunca «tolera» otra forma. */
function pickObject(o: unknown, key?: string): Record<string, unknown> | null {
  if (o == null || typeof o !== 'object' || Array.isArray(o)) return null;
  if (key === undefined) return o as Record<string, unknown>;
  const v = (o as Record<string, unknown>)[key];
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
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
