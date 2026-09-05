import { Injectable, Logger, Optional } from '@nestjs/common';
import { Card, CardProduct, CardProductKind, Finish, GradingCompany, PriceReference, PriceRefKind, PriceSource, Prisma, ProductType, VariantPriceOverride } from '@prisma/client';
// v1.50.2 (§4.38l): la lista blanca de graduadoras — la guarda INV-D no puede consultar por un valor
// que el enum de Prisma no admite (sería un 500 en una ruta de dinero).
import { GRADING_COMPANY_VALUES } from '../../common/enum-values';
import { BusinessException } from '../../common/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  SettingKey,
  SettingKeyType,
  SETTING_DEFAULTS,
  // v1.44-graded-estimate (§4.38d): los MISMOS validadores que aplica el PUT de M2, reusados en la
  // lectura fail-closed de la config (un valor fuera de rango cae a su seed, nunca rompe el request).
  validateGradeList,
  validateGradedEstimateFreshnessDays,
  validateGradingMinUpsidePct,
} from '../settings/settings.constants';
import { FxService } from './fx.service';
import { PokemonTcgIoProvider } from './providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from './providers/graded-sealed.providers';
import { PokemonPriceTrackerBulkProvider } from './providers/pokemonpricetracker-bulk.provider';
import {
  FreshCardPriceProvider,
  FreshCardRef,
  PricingProvider,
  PriceSourceStr,
  buildGradeKey,
  sealedMarketGradeKey,
} from './pricing.types';
import {
  usdToMxnCents,
  computeSalePriceFromCurve,
  computeSealedSalePrice,
  CurvePriceResult,
  PriceBasis,
  SealedSpreadResult,
  VariantPriceControls,
} from '../../common/money';
// MERGE v1.50.2: se BORRA `import { TierId } from '../../common/pricing-tiers'` — P-48 (§4.36) eliminó
// `common/pricing-tiers.ts` junto con `loadSalesRules`/`loadTierMap`. No quedaba ningún uso de `TierId`
// en este archivo; conservar el import «por si acaso» simplemente no compila.
// v1.50-graded-estimate (§4.38): config + claves canónicas del «gancho de grading». La lógica del gate
// vive en la pura `common/graded-estimate.ts`; aquí solo se IZA la config y se LEE el dato.
import {
  DISABLED_GRADED_ESTIMATE_CONFIG,
  GRADED_ESTIMATE_COMPANY,
  GRADED_ESTIMATE_GRADE_KEYS,
  GRADED_ESTIMATE_GRADE_VALUES,
  GradedEstimateConfig,
  GradedEstimateInput,
  gradedEstimateGradeKey,
  isStaleByOrigin,
  GradedEstimateSourceStat,
  sanitizeGradingCostTiers,
  validateGradedEstimateIngestMaxCards,
  validateGradedEstimateManualFreshnessDays,
  validateGradedEstimateMaxRawMultiple,
  validateGradedEstimateMinSampleCount,
  validateGradedEstimateSourceStat,
  validateGradingCostTiers,
} from '../../common/graded-estimate';
// v2.0 (P-48, §4.36.2): LA CURVA. Un solo lector en todo el backend (`loadPricingCurve`), para que no
// vuelva a haber dos rutas de dinero leyendo configuraciones potencialmente distintas.
import {
  CurveLegTrace,
  CurveValidationError,
  PendingReason,
  PricingCurve,
  collectCurveViolations,
  explainBuyFromCurve,
  explainSaleFromCurve,
  normalizePricingCurve,
  resolvePendingReason,
  sanitizePricingCurve,
} from '../../common/pricing-curve';
// P-30 H2 (TECH_DEBT): helper ÚNICO de la clave de variante K=(cardId,productType,gradeKey,finish).
// Estos son los PRODUCTORES de los mismos mapas que catalog.service consume; deben llavear con la
// MISMA fuente que el consumidor (mismo `variantKey`), no con una interpolación hand-rolled paralela.
import { variantKey } from '../../common/variant-key';

function today(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * v1.44-graded-estimate (§4.38d), **v1.51 (M-46, §4.38r)** — las **11** claves del gancho: el **dial
 * único** M10 (`grading_hook_enabled`, exhibición **Y** obtención) + las 10 de M2. Se leen TODAS en una
 * sola query (`SettingsService.getRawMany`) para que la config del gancho cueste **+1 query constante**
 * por request en vez de 11 lecturas sueltas (`SettingsService` no cachea).
 *
 * ⚠️ El número está escrito porque su VALOR es la garantía: añadir un dial y leerlo aparte devuelve el
 * coste a +N, que es exactamente la regresión que QA midió (+7). Si esta lista crece, crece AQUÍ.
 * *(v1.51 la hizo DECRECER: 12 → 11, al fundir los dos diales M10 en uno. La garantía no cambia de
 * naturaleza —una query— pero el número sí, y un número que miente es peor que no tenerlo.)*
 */
const GRADED_ESTIMATE_SETTING_KEYS = [
  SettingKey.GRADING_HOOK_ENABLED,
  SettingKey.GRADED_ESTIMATE_GRADES,
  SettingKey.GRADED_ESTIMATE_HIGHLIGHT_GRADES,
  SettingKey.GRADED_ESTIMATE_FRESHNESS_DAYS,
  SettingKey.GRADING_MIN_UPSIDE_PCT,
  SettingKey.GRADING_COST_TIERS,
  // v1.50.2 — las 5 de M2 del gate de confianza y del ingest. Siguen yendo en la MISMA query: el coste
  // de la config es +1 constante por request, y añadir diales no puede volver a convertirlo en +N (la
  // regresión que QA midió como +7 fue exactamente eso: una lectura por clave).
  SettingKey.GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS,
  SettingKey.GRADED_ESTIMATE_MAX_RAW_MULTIPLE,
  SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT,
  SettingKey.GRADED_ESTIMATE_SOURCE_STAT,
  SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN,
] as const satisfies readonly SettingKeyType[];

/**
 * v1.51 (M-46, §4.38r) — **EL resolver del dial del gancho. Uno solo, y lo consumen los dos lados**:
 * el storefront (vía `loadGradedEstimateConfig`) y el **gate del ingest** (vía
 * `loadGradedEstimateConfigForAdmin` → `cfg.enabled`).
 *
 * Dial M10 `grading_hook_enabled` (seed `off`): SOLO el string `'on'` enciende. Clave ausente, `null`,
 * `true`, `'ON'` o basura ⇒ APAGADO (fail-closed por construcción).
 *
 * ⚠️ Lo que este resolver **no** hace, y es la mitad de su valor: **no mira ninguna clave de
 * curaduría**. `estimatesEnabled`/`highlightEnabled` sí (doblan la validez de `minUpsidePct`,
 * `highlightGrades`, `maxRawMultiple`), y por eso el ingest **no puede** colgarse de ellos: un dedazo
 * en un umbral de vitrina congelaría la obtención de datos (§4.38h.3).
 */
function gradingHookEnabledFrom(raw: Map<SettingKeyType, unknown>): boolean {
  return featureDialOn(raw, SettingKey.GRADING_HOOK_ENABLED);
}

/** SOLO el string `'on'` enciende. Ausente, `null`, `true`, `'ON'` o basura ⇒ APAGADO. */
function featureDialOn(raw: Map<SettingKeyType, unknown>, key: SettingKeyType): boolean {
  const v = raw.has(key) ? raw.get(key) : SETTING_DEFAULTS[key];
  return v === 'on';
}

/**
 * v1.29 (M-31, §4.27f) — filtro de `PriceReference` para la referencia de la CARTA DE SET: incluye las
 * filas legacy/fallback (`cardProductId=null`: PPT, pokemontcg.io, manual, sellado) y las del producto
 * `set_base`/`other`; EXCLUYE las de `deck_exclusive`/`promo` (su precio vive en su producto separado).
 */
export const BASE_CARD_REF_WHERE: Prisma.PriceReferenceWhereInput = {
  OR: [
    { cardProductId: null },
    { cardProduct: { kind: { in: [CardProductKind.set_base, CardProductKind.other] } } },
  ],
};

/**
 * v1.50.3-f (M-43, ARCHITECTURE §4.38l.4.4A, NORMATIVO, DINERO) — **PREDICADO DE LA RUTA DE DINERO.**
 *
 * Se aplica —vía `AND`, para no colisionar con el `OR` de `BASE_CARD_REF_WHERE`— a **TODA** lectura de
 * `PriceReference` cuyo resultado pueda terminar en un monto que alguien cobre, ofrezca o valúe.
 *
 * ### Por qué EXCLUIR y no ordenar (⛔ derogación explícita, §4.38l.4.1)
 * La recomendación previa era meter `graded_estimate` en `PriceSource` con `sourceRank` por debajo de
 * toda fuente real. **Es falsa, y el PoC de GE-1 lo probó:** `sourceRank` vive dentro de `isBetterRef`,
 * que es un **desempate entre candidatas**, y la clave del estimado tiene —casi siempre— **UNA sola
 * fila** (no existe ningún escritor automático de referencia de mercado `graded`, §4.38l.4.6 candado 4):
 *
 * ```
 * pickBestRef([estimado]) -> estimado     // única candidata: gana con CUALQUIER rango
 * ```
 *
 * **Ordenar no es excluir.** Un control que solo actúa en el desempate no protege el caso de candidata
 * única, que es justamente el caso degradado. Por eso el estimado **no pierde la precedencia: no es
 * candidata**, y `isBetterRef` / `sourceRank` / §4.27f-2 **no se tocan** (misma técnica que §4.38m:
 * filtrar ANTES de comparar, nunca dentro del comparador ni dentro de la matemática de la curva).
 *
 * ### La regla que gobierna las rutas FUTURAS (es lo que de verdad cierra la causa)
 * *El default de toda lectura de `PriceReference` es **excluir** las filas que no son `market`;
 * incluirlas es **opt-in explícito** y solo lo hacen las superficies del gancho* (`getGradedEstimatesBatch`,
 * el conjunto motor de `/review` y el `DELETE` de estimados) **más el historial de auditoría**
 * (`priceHistory`, que es donde `refKind` EXPLICA por qué una fila con número no está priciando nada).
 * Un lector nuevo que se olvide del predicado **hereda el comportamiento seguro** — exactamente lo
 * contrario de lo que pasaba antes de M-43.
 *
 * ### Consecuencia declarada (deliberada, fail-closed)
 * Un slab publicado cuya ÚNICA fila de la clave sea un estimado se queda **sin candidata** ⇒
 * `getReference` devuelve `pending` ⇒ `decideSalePrice` da `pendingReason='no_market'` /
 * `basis='pending'` ⇒ **deja de ser vendible en la siguiente lectura**, sin barrido ni migración de
 * datos. Es la dirección correcta del fallo: *una pieza sin precio no le cuesta dinero a nadie; una
 * pieza al 5% de su valor sí* (GE-1: MX$9,200 → MX$460). No es gratis, y por eso el cut-over de
 * §4.38(l.4.7) exige **re-afirmar cada slab con `intent:"market"` ANTES** de migrar.
 */
export const MONEY_REF_WHERE: Prisma.PriceReferenceWhereInput = { refKind: 'market' };

/** Entrada de `applyManualOverride` (objeto, no 8 posicionales: el 9.º parámetro ya no cabía). */
export interface ManualOverrideInput {
  cardId: string;
  productType: ProductType;
  gradeKey: string;
  priceMxnCents: number;
  finish?: Finish;
  /** H-1 (SEC): cliente transaccional del caller, cuando el override es parte de una tx mayor. */
  tx?: Prisma.TransactionClient;
  /** SEC N-3: claves LÓGICAS de dedupe del pendiente que se resuelve. */
  pending?: { sealedProductId?: string | null; cardProductId?: number | null };
  /** M-43 (§4.38l.4.3): NATURALEZA de la fila. Default `market` (ver el porqué en `manualOverride`). */
  refKind?: PriceRefKind;
}

/**
 * M-44b (§4.38l.4.10 punto 5) — lo que había en la fila del día ANTES de pisarla. Son exactamente los
 * tres campos que el dictamen enumera: el monto destruido, su naturaleza y su procedencia.
 */
export interface ManualOverrideBefore {
  priceMxnCents: number;
  refKind: PriceRefKind;
  source: PriceSource;
}

export interface ManualOverrideResult {
  ref: PriceReference;
  /** `null` ⇔ no había fila del día (la escritura CREÓ, no pisó). */
  before: ManualOverrideBefore | null;
}

/** `1234` ⇒ `MX$12.34`. Solo para el mensaje del `409` de M-44 (el operador lee pesos, no centavos). */
function mxn(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const pesos = String(Math.trunc(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}MX$${pesos}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * **M-44 (§4.38l.4.10 · API_CONTRACT v1.50.3-g)** — el `409` que impide que un verbo INFORMATIVO
 * destruya un dato de DINERO.
 *
 * El `message` sí nombra el monto vigente (es lo que le dice al operador que está a punto de pisar algo
 * afirmado como precio); el `details` **NO lo lleva**: no aporta a la decisión, es dato comercial y el
 * operador lo tiene en `priceHistory`. Contrato, literal.
 */
function degradeMarketRefConflict(
  cardId: string,
  gradeKey: string,
  row: { refKind: PriceRefKind; priceMxnCents: number },
  capturedDate: Date,
): BusinessException {
  const grade = gradeKey.split(':')[2] ?? '';
  return BusinessException.conflict(
    'GRADED_ESTIMATE_WOULD_DEGRADE_MARKET_REF',
    `No se puede convertir en ESTIMADO la referencia de MERCADO de PSA ${grade} de esta carta: la fila ` +
      `de hoy vale ${mxn(row.priceMxnCents)} y fue afirmada como precio de mercado. Si quieres cambiar ` +
      'ese precio, usa intent:"market"; si quieres retirar el dato, hazlo con el borrado del gancho.',
    {
      cardId,
      gradeKey,
      currentRefKind: row.refKind,
      capturedDate: capturedDate.toISOString().slice(0, 10),
    },
  );
}

/**
 * Columnas mínimas que necesita la valuación (incl. `source` para la precedencia §4.27f y
 * `cardProductId` para el desempate DETERMINISTA money-safe de M-31, ver `isBetterRef`).
 *
 * v1.50.3-f (M-43): incluye `refKind` porque el batch del GANCHO —única lectura INCLUSIVA de las dos
 * naturalezas— lo proyecta al diagnóstico de admin (`GradedEstimatePreviewDTO.refKind`). En la ruta de
 * dinero es redundante por construcción (`MONEY_REF_WHERE` ya la filtró), y esa redundancia es barata.
 */
const PRICE_REF_SELECT = {
  cardId: true,
  productType: true,
  gradeKey: true,
  finish: true,
  priceMxnCents: true,
  priceUsdCents: true,
  isManualOverride: true,
  source: true,
  capturedDate: true,
  cardProductId: true,
  refKind: true,
} as const;

/**
 * Cota de candidatas AUTOMÁTICAS a leer para el desempate por-clave (M-31, MAYOR-3). Por
 * `(cardId, productType, gradeKey, finish, capturedDate)` dentro de `BASE_CARD_REF_WHERE` las filas
 * solo difieren en `cardProductId` (null | set_base | other): un puñado por día. Bajo
 * `orderBy capturedDate desc`, las filas de los días más recientes (las únicas del TIER AUTOMÁTICO
 * que pueden ganar) caen en el bloque inicial; 32 es una cota holgadísima que las cubre sin traer el
 * histórico entero.
 *
 * §4.27f-2 (P47-2, v1.46): esta cota YA NO gobierna al override MANUAL. Bajo el dictamen de durabilidad
 * cross-day, el override manual es TIER SUPERIOR ABSOLUTO y CANDIDATA PERENNE: gana aunque su
 * `capturedDate` sea de meses atrás frente a una automática de hoy. Por eso NO puede quedar sujeto a
 * `take`/recencia — tras ~32 barridos diarios automáticos caería fuera de la ventana y el feed volvería
 * a pisar el precio humano en silencio (regresión money-losing). La lectura de referencia (getReference /
 * getReferenceByCardProduct) SIEMPRE une a las candidatas del bloque reciente TODAS las filas manuales de
 * la clave (`MANUAL_REF_PREDICATE`, sin cota de fecha), de modo que `pickBestRef` nunca deja de verlas.
 * El cap sigue acotando SOLO el tier automático.
 */
const SAME_DAY_REF_CANDIDATES = 32;

/**
 * §4.27f-2 (P47-2, v1.46) — predicado de override MANUAL de MERCADO: `isManualOverride=true` O
 * `source='manual'` (`manualOverride()` escribe ambos juntos; se casan los dos por robustez). Es la
 * candidata PERENNE de la resolución de referencia: se lee SIN cota de fecha ni `take` y se une a las
 * candidatas recientes, garantizando la durabilidad cross-day del control humano de precio. Se combina
 * con otros filtros vía `AND` para no colisionar con el `OR` de `BASE_CARD_REF_WHERE`.
 */
export const MANUAL_REF_PREDICATE: Prisma.PriceReferenceWhereInput = {
  OR: [{ isManualOverride: true }, { source: 'manual' }],
};

export type RefRow = {
  priceMxnCents: number;
  priceUsdCents: number | null;
  isManualOverride: boolean;
  source: string;
  capturedDate: Date;
  cardProductId: string | null;
};

/**
 * §4.27f — rango de precedencia de FUENTE (menor gana): override manual > tcgcsv_singles > tcgcsv
 * (sellado) > PPT/PokeTrace > pokemontcg.io. Empata con «TCGCSV primario, PPT fallback» de singles.
 */
function sourceRank(source: string, isManualOverride: boolean): number {
  if (isManualOverride || source === 'manual') return 0;
  switch (source) {
    case 'tcgcsv_singles':
    case 'tcgcsv':
      return 1;
    case 'pokemonpricetracker':
    case 'poketrace':
      return 2;
    case 'pokemontcg_io':
      return 3;
    default:
      return 4;
  }
}

/**
 * ¿`a` es MEJOR referencia que `b`? Precedencia TOTALMENTE DETERMINISTA (money-safe, M-31 MAYOR-3):
 *   1. §4.27f-2 (P47-2): el override MANUAL es TIER SUPERIOR ABSOLUTO y DURABLE cross-day. Una fila
 *      manual gana SIEMPRE sobre una automática, sin mirar `capturedDate` — no solo el mismo día. Es
 *      una decisión humana explícita que persiste hasta que el admin la cambie; nunca la supersede una
 *      referencia automática por ser «más fresca».
 *   2. DENTRO del mismo tier (ambas manuales o ambas automáticas): `capturedDate` más reciente gana.
 *   3. A igual tier y día, mejor precedencia de FUENTE (`sourceRank`): entre manuales rank 0; entre
 *      automáticas tcgcsv_singles > tcgcsv > PPT/PokeTrace > pokemontcg.io. NO se iza `sourceRank`
 *      por encima de `capturedDate` dentro del tier: una `tcgcsv_singles` STALE no debe ganarle a un
 *      residuo fresco (sería money-losing).
 *   4. A igual tier, día y fuente, la fila de la VARIANTE RESUELTA (`cardProductId` no nulo, escrita
 *      por el resolver de singles) gana sobre la genérica `cardProductId=null` del ingest (NULLS LAST).
 *   5. Último criterio: orden lexicográfico del `cardProductId` (cuid), para que la elección sea
 *      ESTABLE y REPRODUCIBLE ante un import forzado (`sync {force:true}`), no «cualquiera de las dos».
 */
export function isBetterRef(a: RefRow, b: RefRow): boolean {
  // §4.27f-2 (P47-2): tier manual ABSOLUTO y durable cross-day. Se compara ANTES que `capturedDate`
  // para que un override manual gane aunque su fila sea de días atrás frente a una automática de hoy.
  const am = a.isManualOverride || a.source === 'manual';
  const bm = b.isManualOverride || b.source === 'manual';
  if (am !== bm) return am;
  const at = a.capturedDate.getTime();
  const bt = b.capturedDate.getTime();
  if (at !== bt) return at > bt; // dentro del mismo tier: gana la más fresca.
  const ar = sourceRank(a.source, a.isManualOverride);
  const br = sourceRank(b.source, b.isManualOverride);
  if (ar !== br) return ar < br; // mismo día: precedencia de fuente (determinismo).
  const acp = a.cardProductId;
  const bcp = b.cardProductId;
  if ((acp == null) !== (bcp == null)) return acp != null; // NULLS LAST: la variante resuelta gana.
  if (acp != null && bcp != null && acp !== bcp) return acp < bcp;
  return false;
}

/** Reduce un conjunto de candidatas a la MEJOR según `isBetterRef` (desempate determinista). */
/**
 * v1.51 (M-46, §4.39e) — clave del `Map` de `getReferencesByCardProductBatch`. El eje aquí es el
 * **UUID interno de `CardProduct`** (no el `cardId`), así que NO es `variantKey()` y no debe
 * disfrazarse de ella: son dos espacios de claves distintos y confundirlos sería fusionar el precio
 * de una promo con el de la carta de set. Vive PEGADA a su productor (misma doctrina que
 * `variantKey`): productor y consumidor comparten UNA fuente, así que el `.get()` no puede fallar
 * por un cambio de orden o de separador.
 */
export function cardProductRefKey(p: {
  cardProductId: string;
  productType: ProductType;
  gradeKey: string;
  finish: Finish;
}): string {
  return `${p.cardProductId}|${p.productType}|${p.gradeKey}|${p.finish}`;
}

export function pickBestRef<T extends RefRow>(rows: T[]): T | null {
  let best: T | null = null;
  for (const r of rows) if (best == null || isBetterRef(r, best)) best = r;
  return best;
}

/**
 * `PriceInfo` describe el VALOR DE REFERENCIA (valor de mercado), no el precio de venta.
 *
 * ### v2.1.6 (S48-M2, fase de seguridad) — DTO CERRADO
 * `isManualOverride` **SE RETIRA**. Nunca estuvo declarado en el contrato y el backend lo emitía
 * igual **a endpoints anónimos**: un mapa **scrapeable** de qué cartas llevan precio fijado a mano —
 * o sea dónde falló el feed automático y dónde es más probable que el precio esté desalineado. No se
 * reubica en una superficie admin porque es **REDUNDANTE**: `source === 'manual'` carga exactamente
 * el mismo bit, y mantener dos nombres para un mismo hecho es cómo se diverge.
 *
 * ⚠️ **Quitarlo no basta:** `PriceSource` incluye el valor `manual`, así que **`source` filtra la
 * MISMA señal**. Norma: `source` se **OMITE en toda superficie pública/anónima** (`/catalog/*`,
 * `/buylist/*`) vía `toPublicPriceInfo` y solo viaja en `vault_operator+`. El campo YA era opcional,
 * así que omitirlo no cambia el tipo ni hace que `PriceInfo` signifique cosas distintas según la ruta
 * (eso sí está prohibido para `referenceMxnCents`, que es la CARGA; `source` es **procedencia**).
 * `capturedDate` sí puede viajar en público: la frescura del dato es información legítima de compra.
 */
export interface PriceInfo {
  status: 'priced' | 'pending';
  referenceMxnCents?: number;
  /** PROCEDENCIA — `vault_operator+` únicamente. En público se OMITE (`toPublicPriceInfo`). */
  source?: PriceSourceStr;
  capturedDate?: string;
}

/**
 * v1.50-graded-estimate (§4.38a/g) — UN estimado por grado tal como sale del batch. **EXTIENDE**
 * `GradedEstimateInput` (lo que consumen las puras) y le añade UNA cosa: el `gradeKey` canónico, que la
 * composición necesita para el render y las puras no.
 *
 * ⚠️ **`extends`, no una copia.** Hasta v1.50.2 este tipo REDECLARABA a mano los cuatro campos de
 * `GradedEstimateInput`, contra la promesa de §4.38c de que hay **UNA sola definición** de la forma que
 * consumen las puras. Dos listas de campos que deben coincidir y que nadie obliga a coincidir divergen:
 * añadir un campo al input (como pasó con `isManual`) y olvidarlo aquí compila, y el batch empieza a
 * producir filas que las puras leen como `undefined`. Con `extends`, el compilador lo sostiene.
 *
 * **NO lleva `source` ni `isManualOverride`, y eso es el contrato, no un olvido:** es la garantía
 * ESTRUCTURAL de que ninguna rama de composición pueda decidir nada por el ORIGEN CRUDO del número. Es
 * lo que hace INDISTINGUIBLES la fase 1 (valor fijado a mano por el admin) y la fase 2 (ingest
 * automático) para el cliente. La precedencia `override manual > ingest` ya la resolvió `isBetterRef`
 * DENTRO de la tabla; `isManual` (heredado) solo decide SI la fila se emite, jamás QUÉ (§4.38m).
 */
export interface GradedEstimateRef extends GradedEstimateInput {
  /** Clave canónica `graded:PSA:<grado>` — lo ÚNICO que este tipo añade sobre `GradedEstimateInput`. */
  gradeKey: string;
}

/**
 * v2.1.6 (S48-M2) — proyección PÚBLICA de un `PriceInfo`: **quita la procedencia**. Es el único
 * cuerpo que decide qué sale a superficie anónima; los seams públicos (`catalog`, `buylist`) lo
 * aplican al construir su DTO.
 *
 * Un DTO es **CERRADO**: emitir un campo no declarado es violación de contrato, no una adición
 * inocua. «Aditivo es seguro» vale para el **consumidor**, no para el **emisor** — publicar de más no
 * rompe a nadie, **filtra**.
 *
 * ### v2.1.9 (D2) — la regla de visibilidad de §N.7 se impone en el EMISOR, no en el navegador
 * `priceBasis` parametriza el recorte. En superficie **pública**:
 *
 * ```
 * referenceValue.referenceMxnCents PRESENTE  ⇔  priceBasis === 'market'
 * ```
 *
 * Con `floor`/`override`/`pending` el `PriceInfo` público sale como `{ status }` a secas —
 * `capturedDate` acompaña al número (sin número, la frescura no informa) y `status` viaja SIEMPRE
 * (es la carga estructural, no procedencia).
 *
 * **Por qué aquí y no repartido por seams:** el argumento viejo («el mismo DTO alimenta admin y
 * valuación, así que stripearlo por endpoint haría que `PriceInfo` significara cosas distintas según
 * la ruta») quedó **derogado por escrito**: este proyector YA recorta por superficie (quita `source`),
 * así que la premisa era falsa. El PoC del pentester era literal — `GET /catalog/listings/<id>` **sin
 * token** devolvía `priceBasis:"override"` **+ el número de mercado**, o sea justo el bloque que la UI
 * tiene PROHIBIDO pintar. Una regla que solo vive en el navegador no es una regla: es una sugerencia.
 *
 * ⚠️ Esto **NO releva al front** de obedecer `priceBasis`: es defensa en profundidad, no permiso para
 * inferir comparando cifras.
 *
 * ⚠️ **Omitir `priceBasis` es deliberado en bóveda/portafolio y admin** (`/vault/*`, `/admin/*`):
 * §N.7 las excluye explícitamente — ahí el cliente ve el mercado de lo que **ya posee** y el
 * back-office necesita la procedencia. No "unifiques" pasando el basis también ahí.
 *
 * @param priceBasis Presente ⇒ superficie sujeta a §N.7 (Compra/ficha). Ausente ⇒ sin recorte por basis.
 */
export function toPublicPriceInfo(info: PriceInfo, priceBasis?: PriceBasis): PriceInfo {
  // Se construye por LISTA BLANCA (no `delete`): si mañana `PriceInfo` gana un campo interno, este
  // proyector NO lo deja salir por omisión. Es la diferencia entre cerrar una fuga y cerrar la clase.
  const out: PriceInfo = { status: info.status };
  // v2.1.9 (D2): el NÚMERO de mercado viaja si y solo si el mercado produjo el precio. Omitir el
  // `priceBasis` = superficie NO sujeta a §N.7 (bóveda/portafolio/admin) ⇒ comportamiento de siempre.
  if (priceBasis !== undefined && priceBasis !== 'market') return out;
  if (info.referenceMxnCents !== undefined) out.referenceMxnCents = info.referenceMxnCents;
  if (info.capturedDate !== undefined) out.capturedDate = info.capturedDate;
  return out;
}

/**
 * `GET /admin/pricing/card/:cardId` — historial por fecha/fuente (v2.1.7).
 *
 * Devolvía **filas Prisma crudas** (`id`, `cardProductId`, `fxRate`, `fxBufferPct`, `createdAt`) y la
 * fecha en ISO completo. Es `super_admin`, así que no había fuga pública — pero es la misma doctrina
 * de S48-M2: **un DTO es CERRADO**, y publicar internos de fila invita a que alguien dependa de ellos.
 *
 * La forma es la que el frontend ya declaró como **SUPUESTO** en `contract.ts` (el contrato dice
 * «historial por fecha/fuente» sin fijar campos): alinearse con ella es lo correcto — inventar otra
 * habría roto su pantalla sin ganar nada.
 *
 * `isManualOverride` **sí** viaja aquí, y no contradice S48-M2: allá se retiró de `PriceInfo` por ser
 * REDUNDANTE con `source` en superficie **anónima**; ésta es `super_admin`, donde la procedencia es
 * justamente el dato que se está consultando.
 *
 * ⚠️ Para el arquitecto: esta forma sigue **sin estar declarada** en el contrato. Backend y frontend
 * coinciden hoy por acuerdo tácito, que es exactamente la condición que produjo B-1.
 */
export interface PriceHistoryEntryDTO {
  /** `YYYY-MM-DD` — día de captura, NO instante (igual que `PriceInfo.capturedDate`). */
  capturedDate: string;
  /**
   * ⚠️ El **ENUM**, no `string` (v2.1.7). El acuerdo tácito ya tenía una GRIETA: backend tipaba
   * `string` y frontend `PriceSource`. Con `string`, un valor fuera del enum **compila** de este lado
   * y **rompe el render** del otro sin que nada avise — justo en el campo del que trata la ruta.
   */
  source: PriceSource;
  gradeKey: string;
  productType: ProductType;
  priceMxnCents: number;
  /**
   * Viaja aquí y NO contradice su retiro de `PriceInfo` (v2.1.6): allá era superficie **anónima** y
   * `source === 'manual'` la determinaba por completo; aquí es `super_admin` de **auditoría**, la
   * procedencia **es** la pregunta que el endpoint contesta, y **no es redundante per-fila** —
   * `sourceRank` trata las dos señales como SEPARADAS (`isManualOverride || source === 'manual'`),
   * así que una fila puede venir marcada manual con un `source` distinto de `manual`.
   *
   * La regla que generaliza: la pregunta correcta nunca es «¿este campo es sensible?» sino
   * **«¿es sensible PARA QUIEN LEE ESTA RUTA?»**.
   */
  isManualOverride: boolean;
  /**
   * v1.50.3-f (M-43, contrato §DTOs) — **NATURALEZA** de la fila, ORTOGONAL a `source` (procedencia) y
   * a `isManualOverride`. `"market"` = puede resolver dinero; `"graded_estimate"` = **jamás** lo
   * resuelve (§4.38l.4).
   *
   * En una superficie de AUDITORÍA es el dato que explica **por qué una fila con número no está
   * priciando nada** — sin él, el historial muestra una cifra viva junto a una pieza sin precio y no
   * hay forma de reconciliar las dos observaciones. Por eso `priceHistory` es una de las lecturas que
   * **no** aplica `MONEY_REF_WHERE`: aquí las dos naturalezas se ven, y este campo las distingue.
   *
   * **Aditivo**: las filas anteriores a M-43 son `"market"` por el default de la columna.
   */
  refKind: PriceRefKind;
}

/**
 * v2.1.7 — **LA proyección** de una `PriceReference` a su forma declarada. Un solo cuerpo para el
 * historial y para la respuesta del override manual.
 *
 * ### La norma que la obliga (§M2, y es la causa raíz de esta familia de bugs)
 * **Ningún endpoint devuelve una entidad Prisma directamente; siempre una proyección declarada.**
 * Cuando la respuesta **ES** la entidad, la forma de la API la define el **schema**, no el contrato —
 * y entonces **cada migración es un cambio de contrato silencioso**. M-41 añadió columnas a tres
 * modelos; con el patrón anterior, cualquier columna futura se **auto-publicaba** sin que nadie lo
 * decidiera. Es la misma máquina que produjo el hueco de `details`, el de `PriceInfo` y B-1.
 *
 * Se construye por **lista blanca** (no `delete`, no spread de la fila): una columna nueva NO sale por
 * omisión, que es exactamente la propiedad que se busca.
 */
export function toPriceHistoryEntry(row: {
  capturedDate: Date;
  source: PriceSource;
  gradeKey: string;
  productType: ProductType;
  priceMxnCents: number;
  isManualOverride: boolean;
  refKind: PriceRefKind;
}): PriceHistoryEntryDTO {
  return {
    capturedDate: row.capturedDate.toISOString().slice(0, 10),
    source: row.source,
    gradeKey: row.gradeKey,
    productType: row.productType,
    priceMxnCents: row.priceMxnCents,
    isManualOverride: row.isManualOverride,
    // M-43: la lista blanca se AMPLÍA explícitamente (una columna nueva no sale por omisión; ésa es la
    // propiedad que la proyección existe para tener). Contrato v1.50.3-f, `PriceHistoryEntryDTO`.
    refKind: row.refKind,
  };
}

/** v1.29 (§4.27i) — precio por variante de un producto separado (CardProductDTO.prices). */
export interface CardProductPriceRow {
  finish: Finish;
  marketReferenceMxnCents: number | null;
  capturedDate: string | null;
}

/** v1.29 (§4.27i) — CardProductDTO server-side (deck_exclusive/promo) para `separateProducts`. */
export interface CardProductInfo {
  productId: number;
  kind: CardProductKind;
  name: string;
  finishes: Finish[];
  prices: CardProductPriceRow[];
}

/**
 * v1.26 (P-7 ⑤, §4.24e) — resultado de `refreshCardPrices`: qué cartas obtuvieron una referencia
 * FRESCA (`refreshed`) vs cuáles se quedaron sin precio nuevo (`pending`, caen a la ref almacenada).
 * `dailyLimited` = el proveedor de PAGA agotó su cuota diaria (parada; el resto queda pending).
 */
export interface RefreshCardPricesResult {
  refreshed: string[];
  pending: string[];
  dailyLimited: boolean;
}

/** v1.26 (P-7 ⑤) — cota DURA de cartas por llamada de reprecio fresco (nunca un barrido). */
export const MAX_FRESH_REPRICE_CARDS = 50;

/**
 * v2.0 (P-48, §4.36.5b) — LA DECISIÓN DE VENTA de una variante: monto **y** veredicto, juntos e
 * inseparables. Es lo que devuelve el seam único del eje de venta (`decideSalePrice` /
 * `computeSalePriceForItem`).
 *
 * INVARIANTE que sostiene todo lo demás: `pendingReason != null` ⇒ `priceCents === null` y
 * `basis === 'pending'`. Un caller no puede leer un precio publicable de una variante bloqueada
 * porque **no existe tal precio en el objeto** — el guardarraíl deja de depender de que cada
 * consumidor se acuerde de consultarlo.
 */
export interface SalePriceDecision extends CurvePriceResult {
  /**
   * `null` = se puede publicar/cobrar/ofrecer. No-null = BLOQUEADA, con el motivo que hace TRIABLE la
   * cola: `no_market` (lo cura solo el barrido) vs `premium_at_floor` (necesita que el dueño mire).
   */
  pendingReason: PendingReason | null;
}

/**
 * PricingService — Orquesta el pricing (ARCHITECTURE §4.1):
 * 1. Elige provider por productType (dial M10).
 * 2. Cache diario: revisa PriceReference del día antes de llamar la API.
 * 3. Aplica FX + colchón para priceMxnCents.
 * 4. Si null y sin override → PendingPriceEntry (precio pendiente, escala al dueño).
 * Solo se pricea la bóveda (el llamador pasa cartas en bóveda).
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);
  private readonly providers: PricingProvider[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly fx: FxService,
    tcgIo: PokemonTcgIoProvider,
    ppt: PokemonPriceTrackerProvider,
    poketrace: PokeTraceProvider,
    // v1.26 (P-7 ⑤): proveedores del fetch FRESCO puntual. PPT PRIMARIO (cuota diaria, por
    // `tcgplayerId`), pokemontcg.io FALLBACK (por `externalId`, reusa el `tcgIo` ya inyectado).
    // `@Optional()` para no romper los call-sites que construyen el servicio con los 6 args previos.
    @Optional() pptBulk?: PokemonPriceTrackerBulkProvider,
  ) {
    this.providers = [tcgIo, ppt, poketrace];
    // Orden de fetch fresco: PRIMARIO (PPT) → FALLBACK (pokemontcg.io). Se filtran los ausentes.
    this.freshProviders = ([pptBulk, tcgIo] as (FreshCardPriceProvider | undefined)[]).filter(
      (p): p is FreshCardPriceProvider => p != null,
    );
  }

  /** v1.26 (P-7 ⑤) — cadena de fetch fresco (PPT primario → pokemontcg.io fallback). */
  private readonly freshProviders: FreshCardPriceProvider[];

  private async providerFor(productType: ProductType): Promise<PricingProvider | undefined> {
    const key =
      productType === 'raw'
        ? SettingKey.PRICING_PROVIDER_RAW
        : productType === 'graded'
          ? SettingKey.PRICING_PROVIDER_GRADED
          : SettingKey.PRICING_PROVIDER_SEALED;
    const wanted = await this.settings.getString(key);
    return this.providers.find((p) => p.source === wanted && p.supports(productType));
  }

  /**
   * v1.x-fx-live (FX AL VUELO, money-safe) — Snapshot de FX vigente para recalcular referencias de
   * MERCADO en USD al momento de VALUAR (no al sincronizar). Devuelve `null` si `FxService` falla o
   * no da una tasa válida (> 0); en ese caso la valuación cae al `priceMxnCents` almacenado (último
   * válido) — NUNCA se rompe la valuación ni se anula una referencia por un fallo de FX.
   */
  async fxSnapshotSafe(): Promise<{ rate: number; bufferPct: number } | null> {
    try {
      const fx = await this.fx.getCurrent();
      if (fx && Number.isFinite(fx.rate) && fx.rate > 0) {
        return { rate: fx.rate, bufferPct: fx.bufferPct };
      }
    } catch (e) {
      this.logger.warn(
        `FX getCurrent falló al valuar; se usa priceMxnCents congelado (último válido): ${(e as Error).message}`,
      );
    }
    return null;
  }

  /**
   * v1.x-fx-live — Convierte UNA fila `PriceReference` al MXN VIGENTE.
   *
   * Regla de distinción "referencia de mercado viva" vs "precio histórico/aceptado":
   *  - `priceUsdCents != null` y NO es override manual → REFERENCIA DE MERCADO en USD: se recalcula
   *    con la FX vigente (`fx`) → cambiar `fx_manual_override_rate`/Banxico mueve el precio AL
   *    INSTANTE, sin re-sync. El `priceMxnCents` almacenado queda solo como fallback money-safe.
   *  - `isManualOverride=true` (override del admin en MXN, `priceUsdCents=null`) → CONGELADO (el admin
   *    fijó pesos a mano; no se toca).
   *  - `priceUsdCents=null` sin override (proveedor nativo en MXN) → CONGELADO (no hay FX que aplicar).
   *
   * Money-safe: si `fx` es `null` (fallo de FX) o el recomputo no resulta finito y > 0, cae al
   * `priceMxnCents` almacenado (invariante `market > 0`; nunca se anula la referencia).
   */
  liveMxnCents(
    ref: { priceMxnCents: number; priceUsdCents: number | null; isManualOverride: boolean },
    fx: { rate: number; bufferPct: number } | null,
  ): number {
    if (fx == null || ref.priceUsdCents == null || ref.isManualOverride) return ref.priceMxnCents;
    const live = usdToMxnCents(ref.priceUsdCents, fx.rate, fx.bufferPct);
    return Number.isFinite(live) && live > 0 ? live : ref.priceMxnCents;
  }

  /**
   * Lee la referencia vigente más reciente (sin filtro de fecha, `capturedDate desc`) para una
   * carta/tipo/grado/ACABADO, en paridad con la valuación del cliente (HoldingDTO).
   * v1.6-finish: `finish` es una columna ortogonal a `gradeKey` (default `normal` para
   * graded/sealed y compatibilidad). Cada acabado tiene su propia PriceReference.
   *
   * v1.x-fx-live: si la referencia es de MERCADO en USD, `referenceMxnCents` se RECALCULA con la FX
   * vigente (`liveMxnCents`), no con el `priceMxnCents` congelado en la ingesta.
   */
  async getReference(
    cardId: string,
    productType: ProductType,
    gradeKey: string,
    finish: Finish = 'normal',
  ): Promise<PriceInfo> {
    // v1.29 (M-31, §4.27f): la referencia de la CARTA DE SET considera SOLO filas del set_base/other
    // (o legacy `cardProductId=null`); NUNCA una fila de deck_exclusive/promo (ese precio vive en su
    // producto separado).
    // M-31 MAYOR-3 (money-safe): el price-ingest diario escribe una fila `cardProductId=null` y el
    // resolver de singles escribe otra `cardProductId=<set_base>` el MISMO día; ambas pueden coexistir
    // (p. ej. un `sync {force:true}`). `capturedDate desc` a secas es NO determinista para ese empate,
    // así que NO se toma «la primera del orden»: se leen las candidatas del día y se elige la mejor con
    // `isBetterRef` (fuente → cardProductId NULLS LAST → cuid), estable y reproducible.
    // §4.27f-2 (P47-2, v1.46): el bloque reciente va CAPADO (`take`) al tier automático, pero el override
    // MANUAL es candidata PERENNE (durable cross-day). Se une una lectura DIRIGIDA de TODAS las filas
    // manuales de la clave SIN cota de fecha ni `take`, de modo que un override humano de meses atrás
    // nunca cae fuera de la ventana ni lo pisa el barrido diario. `pickBestRef` desempata el conjunto.
    // v1.50.3-f (M-43, §4.38l.4.4A): `MONEY_REF_WHERE` en **las dos** queries — el bloque reciente y el
    // `MANUAL_REF_PREDICATE`. Olvidarlo en la segunda habría dejado vivo el caso exacto de GE-1: el
    // estimado se escribe SIEMPRE con `isManualOverride=true` por la vía manual, así que es justamente
    // la fila que la lectura de candidatas PERENNES trae sin cota de fecha (y por eso el estimado
    // rancio a −400 días seguía priciando el slab). Se aplica por `AND` para no colisionar con el `OR`
    // de `BASE_CARD_REF_WHERE`.
    const [dayRows, manualRows] = await Promise.all([
      this.prisma.priceReference.findMany({
        where: { cardId, productType, gradeKey, finish, AND: [MONEY_REF_WHERE, BASE_CARD_REF_WHERE] },
        orderBy: [{ capturedDate: 'desc' }, { cardProductId: { sort: 'asc', nulls: 'last' } }],
        select: PRICE_REF_SELECT,
        take: SAME_DAY_REF_CANDIDATES,
      }),
      this.prisma.priceReference.findMany({
        where: {
          cardId,
          productType,
          gradeKey,
          finish,
          AND: [MONEY_REF_WHERE, BASE_CARD_REF_WHERE, MANUAL_REF_PREDICATE],
        },
        select: PRICE_REF_SELECT,
      }),
    ]);
    const ref = pickBestRef([...dayRows, ...manualRows]);
    if (!ref) return { status: 'pending' };
    const fx = await this.fxSnapshotSafe();
    return {
      status: 'priced',
      referenceMxnCents: this.liveMxnCents(ref, fx),
      source: ref.source as PriceSourceStr,
      capturedDate: ref.capturedDate.toISOString().slice(0, 10),
    };
  }

  /**
   * v1.30 (M-32, §4.29) — Resuelve un `CardProduct` por su `tcgplayerProductId` (== el productId que
   * el front recibió en `CardProductDTO.productId`/`separateProducts`, NO el UUID interno). Lectura pura:
   * devuelve la fila o `null` (el caller decide el error PRODUCT_NOT_FOUND / valida que cuelgue del
   * cardId → PRODUCT_CARD_MISMATCH). Reusa el `@unique tcgplayerProductId` de M-31 (§4.27b).
   */
  async findCardProductByTcgId(tcgplayerProductId: number): Promise<CardProduct | null> {
    // PROJECTION-EXEMPT: lectura interna de resolución (`findCardProductByTcgId`); el caller decide
    // PRODUCT_NOT_FOUND / PRODUCT_CARD_MISMATCH y proyecta lo que expone (`CardProductDTO`).
    return this.prisma.cardProduct.findUnique({ where: { tcgplayerProductId } });
  }

  /**
   * v1.51 (M-46, §4.39e/f) — hermana EN LOTE de `findCardProductByTcgId`: **UNA** query para N
   * productos. Existe porque la mesa de decisión y la emisión de la oferta resuelven las N líneas de
   * una solicitud de golpe; con la versión single serían N `findUnique` en una pantalla que se abre
   * por cada solicitud. Misma lectura pura: devuelve lo que hay, y el caller decide
   * `PRODUCT_NOT_FOUND` / `PRODUCT_CARD_MISMATCH`.
   */
  async findCardProductsByTcgIds(tcgplayerProductIds: number[]): Promise<Map<number, CardProduct>> {
    const ids = [...new Set(tcgplayerProductIds)];
    if (ids.length === 0) return new Map();
    // PROJECTION-EXEMPT: misma lectura interna de resolución que `findCardProductByTcgId`.
    const rows = await this.prisma.cardProduct.findMany({ where: { tcgplayerProductId: { in: ids } } });
    return new Map(rows.map((r) => [r.tcgplayerProductId, r]));
  }

  /**
   * v1.30 (M-32, §4.29b) — Referencia de mercado de un producto SEPARADO: `PriceReference` filtrada por
   * ESE `cardProductId` (UUID interno de M-31), no por (cardId, finish) del set_base. Su precio propio
   * (source `tcgcsv_singles` primario, override/PPT si aplica). Sin fila ⇒ `pending` («—», nunca 0,
   * misma invariante H1/H2/H3). FX recalculada al vuelo como en `getReference`.
   */
  async getReferenceByCardProduct(
    cardProductInternalId: string,
    productType: ProductType,
    gradeKey: string,
    finish: Finish = 'normal',
  ): Promise<PriceInfo> {
    // M-31 MAYOR-3 (money-safe): mismo desempate DETERMINISTA que `getReference`. Aquí todas las filas
    // comparten `cardProductId`, así que el empate que importa es a igual día por FUENTE (p. ej. un
    // override manual vs tcgcsv_singles del mismo día): se elige con `isBetterRef`, no «la primera».
    // §4.27f-2 (P47-2, v1.46): consistente con `getReference` — el bloque reciente va CAPADO al tier
    // automático y se une la lectura DIRIGIDA de TODAS las filas manuales de ESTE `cardProductId` (sin
    // cota de fecha ni `take`), para que el override manual siga siendo candidata perenne durable.
    const [dayRows, manualRows] = await Promise.all([
      this.prisma.priceReference.findMany({
        where: { cardProductId: cardProductInternalId, productType, gradeKey, finish, ...MONEY_REF_WHERE },
        orderBy: { capturedDate: 'desc' },
        select: PRICE_REF_SELECT,
        take: SAME_DAY_REF_CANDIDATES,
      }),
      this.prisma.priceReference.findMany({
        where: {
          cardProductId: cardProductInternalId,
          productType,
          gradeKey,
          finish,
          // M-43 (§4.38l.4.4A): también aquí, y también en LAS DOS queries. Hoy una fila de estimado
          // nunca lleva `cardProductId` (§4.38a: el estimado es de la CARTA), así que el predicado es
          // redundante — se pone igual porque la regla es del LECTOR, no del escritor: la garantía debe
          // sobrevivir a que mañana alguien escriba un estimado por producto.
          AND: [MONEY_REF_WHERE, MANUAL_REF_PREDICATE],
        },
        select: PRICE_REF_SELECT,
      }),
    ]);
    const ref = pickBestRef([...dayRows, ...manualRows]);
    if (!ref) return { status: 'pending' };
    const fx = await this.fxSnapshotSafe();
    return {
      status: 'priced',
      referenceMxnCents: this.liveMxnCents(ref, fx),
      source: ref.source as PriceSourceStr,
      capturedDate: ref.capturedDate.toISOString().slice(0, 10),
    };
  }

  /**
   * v1.16-master-set (§4.17c) — cierra **RB-8/BE-4/D3**. Resuelve la "referencia vigente = MÁS
   * RECIENTE por acabado" para N ítems en **1** query (en vez de N `getReference`). Devuelve un
   * `Map` clave `cardId|productType|gradeKey|finish` → PriceInfo (missing = pending).
   *
   * Misma regla de valuación que `getReference` (sin filtro de fecha, `capturedDate desc`, primera
   * fila por clave). La usan `bulk-publish` y `fetchSellable` (pago mínimo de BE-25); disponible para
   * `holdings`/`ownedItemRefs`/`inventoryValue` (deuda diferida, misma dirección).
   */
  async getReferencesBatch(
    items: { cardId: string; productType: ProductType; gradeKey: string; finish: Finish }[],
  ): Promise<Map<string, PriceInfo>> {
    const map = new Map<string, PriceInfo>();
    if (items.length === 0) return map;
    // P-30 H2: MISMA fuente de clave que el consumidor (`variantKey`). Producir e indexar el Map con el
    // helper compartido garantiza que el `.get()` del consumidor caiga en la misma entrada (round-trip).
    const keyOf = (i: { cardId: string; productType: ProductType; gradeKey: string; finish: Finish }) =>
      variantKey(i);
    const wanted = new Set(items.map(keyOf));
    const rows = await this.prisma.priceReference.findMany({
      where: {
        cardId: { in: [...new Set(items.map((i) => i.cardId))] },
        productType: { in: [...new Set(items.map((i) => i.productType))] },
        gradeKey: { in: [...new Set(items.map((i) => i.gradeKey))] },
        finish: { in: [...new Set(items.map((i) => i.finish))] },
        // v1.29 (M-31, §4.27f): excluye filas de deck_exclusive/promo del precio de la carta de set.
        // v1.50.3-f (M-43, §4.38l.4.4A): + la naturaleza. Éste es el seam que alimenta bulk-publish,
        // bóveda, binder, buylist y los reportes de dinero de admin: un estimado que se colara aquí
        // pricearía a la vez decenas de piezas.
        AND: [MONEY_REF_WHERE, BASE_CARD_REF_WHERE],
      },
      orderBy: { capturedDate: 'desc' },
      select: PRICE_REF_SELECT,
    });
    // v1.x-fx-live: FX izada UNA vez por request (no por ítem) para el recomputo al vuelo.
    const fx = await this.fxSnapshotSafe();
    // v1.29: agrupa por clave y elige la MEJOR fila por precedencia (override > tcgcsv_singles > PPT),
    // no simplemente «la primera del orden desc» (que podía mezclar fuentes del mismo día).
    const bestByKey = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const k = keyOf(r);
      if (!wanted.has(k)) continue;
      const cur = bestByKey.get(k);
      if (cur == null || isBetterRef(r, cur)) bestByKey.set(k, r);
    }
    for (const [k, r] of bestByKey) {
      map.set(k, {
        status: 'priced',
        referenceMxnCents: this.liveMxnCents(r, fx),
        source: r.source as PriceSourceStr,
        capturedDate: r.capturedDate.toISOString().slice(0, 10),
      });
    }
    return map;
  }

  /**
   * v1.51 (M-46, §4.39e) — hermana EN LOTE de `getReferenceByCardProduct`: la referencia de los N
   * **productos SEPARADOS** (deck_exclusive/promo) de una solicitud en **UNA** query.
   *
   * Es el eje que `getReferencesBatch` **no** cubre y no puede cubrir: aquél aplica
   * `BASE_CARD_REF_WHERE`, que EXCLUYE justamente estas filas (§4.27f — el precio de un producto
   * separado no es el de la carta de set). Sin esta hermana, una solicitud de promos volvería a hacer
   * un `getReferenceByCardProduct` por línea.
   *
   * Misma regla de valuación y mismo desempate determinista que el resto del eje
   * (`isBetterRef` + `liveMxnCents` con la FX izada UNA vez). Clave del `Map`:
   * `cardProductRefKey` — producida e indexada aquí, y consumida con la MISMA función.
   */
  async getReferencesByCardProductBatch(
    items: { cardProductId: string; productType: ProductType; gradeKey: string; finish: Finish }[],
  ): Promise<Map<string, PriceInfo>> {
    const map = new Map<string, PriceInfo>();
    if (items.length === 0) return map;
    const wanted = new Set(items.map(cardProductRefKey));
    const rows = await this.prisma.priceReference.findMany({
      where: {
        cardProductId: { in: [...new Set(items.map((i) => i.cardProductId))] },
        productType: { in: [...new Set(items.map((i) => i.productType))] },
        gradeKey: { in: [...new Set(items.map((i) => i.gradeKey))] },
        finish: { in: [...new Set(items.map((i) => i.finish))] },
        // M-43 (§4.38l.4.4A): ruta de dinero ⇒ SOLO filas de mercado. Un estimado que se colara aquí
        // pondría precio a la oferta de una promo.
        ...MONEY_REF_WHERE,
      },
      orderBy: { capturedDate: 'desc' },
      select: PRICE_REF_SELECT,
    });
    const fx = await this.fxSnapshotSafe();
    const bestByKey = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (r.cardProductId == null) continue; // defensivo: el `where` ya lo impide.
      const k = cardProductRefKey({
        cardProductId: r.cardProductId,
        productType: r.productType,
        gradeKey: r.gradeKey,
        finish: r.finish,
      });
      if (!wanted.has(k)) continue;
      const cur = bestByKey.get(k);
      if (cur == null || isBetterRef(r, cur)) bestByKey.set(k, r);
    }
    for (const [k, r] of bestByKey) {
      map.set(k, {
        status: 'priced',
        referenceMxnCents: this.liveMxnCents(r, fx),
        source: r.source as PriceSourceStr,
        capturedDate: r.capturedDate.toISOString().slice(0, 10),
      });
    }
    return map;
  }

  /**
   * v1.22-2 / N-15 (ARCHITECTURE §4.22a-6) — `hasPricedRef` EN LOTE (sin N+1). Para un conjunto de
   * cartas, devuelve `Map<cardId, Set<Finish>>` con los acabados que TIENEN una `PriceReference`
   * vigente RAW `raw:NM` con `priceMxnCents > 0` — el MISMO por-acabado que alimenta
   * `referenceValue`/quote. Es la entrada `pricedFinishes` de `computeDisplayFinishes`.
   *
   * UNA sola query (`WHERE cardId IN (...)` + `productType='raw'` + `gradeKey='raw:NM'` +
   * `priceMxnCents > 0`, `distinct [cardId, finish]`), en vez de un `getReference` por (carta,acabado).
   * No aplica FX: solo interesa la EXISTENCIA de precio > 0 (display), no el monto valuado; la
   * invariante de ingesta es `market > 0`, así que el `priceMxnCents` persistido ya lo refleja.
   */
  async getPricedRawFinishesBatch(cardIds: string[]): Promise<Map<string, Set<Finish>>> {
    const map = new Map<string, Set<Finish>>();
    const ids = [...new Set(cardIds)];
    if (ids.length === 0) return map;
    const rows = await this.prisma.priceReference.findMany({
      where: {
        cardId: { in: ids },
        productType: 'raw',
        gradeKey: 'raw:NM',
        priceMxnCents: { gt: 0 },
        // v1.29 (M-31): un precio de deck_exclusive/promo NO cuenta como precio de la carta de set.
        // M-43: y un estimado tampoco «tiene precio» a efectos de display. Redundante hoy (esta query
        // es `raw:NM` y el estimado es `graded:PSA:*`), presente por la regla del lector: el default de
        // toda lectura de `PriceReference` es EXCLUIR lo que no es `market` (§4.38l.4.4A).
        AND: [MONEY_REF_WHERE, BASE_CARD_REF_WHERE],
      },
      select: { cardId: true, finish: true },
      distinct: ['cardId', 'finish'],
    });
    for (const r of rows) {
      let s = map.get(r.cardId);
      if (!s) {
        s = new Set<Finish>();
        map.set(r.cardId, s);
      }
      s.add(r.finish);
    }
    return map;
  }

  /**
   * v1.29 (M-31, §4.27i) — Productos SEPARADOS (`deck_exclusive`/`promo`) por carta EN LOTE (sin N+1),
   * con su precio POR VARIANTE resuelto (source tcgcsv_singles primero, USD→MXN vigente). Alimenta
   * `MasterSetCardCellDTO.separateProducts` (CardProductDTO). Un acabado sin precio ⇒
   * `marketReferenceMxnCents: null` («—», nunca 0). Cartas sin productos separados NO aparecen en el Map.
   */
  async getSeparateProductsByCard(cardIds: string[]): Promise<Map<string, CardProductInfo[]>> {
    const out = new Map<string, CardProductInfo[]>();
    const ids = [...new Set(cardIds)];
    if (ids.length === 0) return out;

    const products = await this.prisma.cardProduct.findMany({
      where: { cardId: { in: ids }, kind: { in: ['deck_exclusive', 'promo'] } },
      select: { id: true, cardId: true, tcgplayerProductId: true, kind: true, name: true, finishes: true },
      orderBy: { tcgplayerProductId: 'asc' },
    });
    if (products.length === 0) return out;

    const productIds = products.map((p) => p.id);
    const refs = await this.prisma.priceReference.findMany({
      // M-43 (§4.38l.4.4A): `marketReferenceMxnCents` es dinero que ve el operador ⇒ solo `market`.
      where: { cardProductId: { in: productIds }, productType: 'raw', gradeKey: 'raw:NM', ...MONEY_REF_WHERE },
      orderBy: { capturedDate: 'desc' },
      select: PRICE_REF_SELECT, // incluye `cardProductId` (M-31 MAYOR-3).
    });
    // Mejor fila por (cardProductId, finish) según precedencia §4.27f.
    const bestByPf = new Map<string, RefRow>();
    for (const r of refs) {
      const k = `${r.cardProductId}|${r.finish}`;
      const cur = bestByPf.get(k);
      if (cur == null || isBetterRef(r, cur)) bestByPf.set(k, r);
    }
    const fx = await this.fxSnapshotSafe();

    for (const p of products) {
      const prices = (p.finishes as Finish[]).map((finish) => {
        const r = bestByPf.get(`${p.id}|${finish}`);
        const priced = r != null && r.priceMxnCents > 0;
        return {
          finish,
          marketReferenceMxnCents: priced ? this.liveMxnCents(r as RefRow, fx) : null,
          capturedDate: priced ? (r as RefRow).capturedDate.toISOString().slice(0, 10) : null,
        };
      });
      const info: CardProductInfo = {
        productId: p.tcgplayerProductId,
        kind: p.kind,
        name: p.name,
        finishes: p.finishes as Finish[],
        prices,
      };
      const list = out.get(p.cardId);
      if (list) list.push(info);
      else out.set(p.cardId, [info]);
    }
    return out;
  }

  /**
   * v1.28 (P-18/M-30, ARCHITECTURE §4.26b) — controles por variante (`VariantPriceOverride`) EN
   * LOTE: UNA query por request (patrón `getReferencesBatch`, sin N+1). Devuelve
   * `Map<'cardId|productType|gradeKey|finish', VariantPriceOverride>`; clave ausente = SIN fila =
   * comportamiento actual (cadena de reglas). La clave espeja la única de la tabla (M-30).
   * Consumidores: buylist (quote/batch/createRequest), catálogo `fetchSellable`, bulk-publish,
   * binder (`pricing?`/buyable) y la propia consola `variant-controls`.
   */
  async getVariantOverridesBatch(
    items: { cardId: string; productType: ProductType; gradeKey: string; finish: Finish }[],
  ): Promise<Map<string, VariantPriceOverride>> {
    const map = new Map<string, VariantPriceOverride>();
    if (items.length === 0) return map;
    // P-30 H2: misma fuente de clave que el consumidor (`variantKey`), ver `getReferencesBatch`.
    const keyOf = (i: { cardId: string; productType: ProductType; gradeKey: string; finish: Finish }) =>
      variantKey(i);
    const wanted = new Set(items.map(keyOf));
    const rows = await this.prisma.variantPriceOverride.findMany({
      where: {
        cardId: { in: [...new Set(items.map((i) => i.cardId))] },
        productType: { in: [...new Set(items.map((i) => i.productType))] },
        gradeKey: { in: [...new Set(items.map((i) => i.gradeKey))] },
        finish: { in: [...new Set(items.map((i) => i.finish))] },
      },
    });
    for (const r of rows) {
      const k = keyOf(r);
      if (wanted.has(k)) map.set(k, r); // fila única por clave (unique M-30): sin dedupe adicional
    }
    return map;
  }

  /**
   * v1.28 (P-18) — control por variante de UN item (uso single; los flujos de lote usan
   * `getVariantOverridesBatch`). `null` = sin fila (cadena de reglas de siempre).
   */
  async getVariantOverride(
    cardId: string,
    productType: ProductType,
    gradeKey: string,
    finish: Finish,
  ): Promise<VariantPriceOverride | null> {
    const map = await this.getVariantOverridesBatch([{ cardId, productType, gradeKey, finish }]);
    // P-30 H2: el lookup single usa el MISMO `variantKey` con que `getVariantOverridesBatch` indexó.
    return map.get(variantKey({ cardId, productType, gradeKey, finish })) ?? null;
  }

  /**
   * v2.0 (P-48, §4.36.2) — EL ÚNICO LECTOR DE LA CURVA en todo el backend. Funde
   * `loadBuylistRules()` + `loadSalesRules()` (y el `BuylistService.buylistRules()` que no delegaba en
   * este servicio) en un solo loader: la curva vive en UNA clave, así que dos loaders solo abrirían la
   * puerta a leerla dos veces y ver dos versiones. Se iza UNA VEZ por request (patrón BE-25) y se
   * comparte entre los dos ejes.
   *
   * Money-safe: un valor persistido inválido (edición manual en BD) NO apaga la publicación y la
   * cotización de todo el catálogo — cae al seed de §N.2 y lo GRITA en el log. «Siempre hay curva» es
   * invariante de diseño (§4.36.2: ya no existe el caso «sin regla»).
   */
  async loadPricingCurve(): Promise<PricingCurve> {
    const raw = await this.settings.getRaw(SettingKey.PRICING_CURVE);
    const { curve, fellBack } = sanitizePricingCurve(raw);
    if (fellBack) {
      this.logger.error(
        `[MONEY] El setting ${SettingKey.PRICING_CURVE} es INVÁLIDO en BD: se está usando el seed de PROJECT §N.2. ` +
          'Revísalo en M2 (PUT /admin/pricing/curve) — el precio publicado y el cotizado NO son los configurados.',
      );
    }
    return curve;
  }

  /**
   * v2.1 (P-48, §4.36.8a) — **DRY-RUN de la curva**. Evalúa una curva BORRADOR contra N mercados de
   * sonda y devuelve, por sonda, el resultado con el borrador Y con la curva **VIGENTE** (que se lee
   * de ESTE almacén, jamás del cliente: si el cliente pudiera echarla de vuelta, un cliente rancio
   * pintaría una columna «VIGENTE» que no es la vigente — y ésa es contra la que el dueño mide su
   * cambio).
   *
   * **No persiste, no audita, no autoriza.** No evalúa el guardarraíl ni consulta rareza, overrides,
   * bounties ni inventario: opera sobre mercados HIPOTÉTICOS, así que `basis` solo puede valer
   * `market | floor | pending`.
   *
   * Usa las MISMAS puras que el precio real (`explainSaleFromCurve`/`explainBuyFromCurve` son el
   * cuerpo de `resolveSale/BuyFromCurve`) y el MISMO validador que el `PUT` — que es todo el punto:
   * sin este endpoint el editor reimplementaría la aritmética Y los invariantes en el cliente, y el
   * dueño calibraría contra un número que el backend no produce (el bug de P-48 en espejo).
   */
  async previewCurve(
    draft: PricingCurve,
    marketsCents: number[],
  ): Promise<{
    rows: {
      marketCents: number;
      draft: { sale: CurveLegTrace; buy: CurveLegTrace };
      saved: { sale: CurveLegTrace; buy: CurveLegTrace };
      deltaCents: { sale: number | null; buy: number | null };
    }[];
    violations: CurveValidationError[];
  }> {
    // La VIGENTE la resuelve el servidor con SU almacén, al atender la petición.
    const saved = await this.loadPricingCurve();
    const normalizedDraft = normalizePricingCurve(draft);
    // El server DEDUPLICA y ORDENA ascendente (la tabla de referencia del editor los quiere así, y
    // dejarlo aquí evita otra reimplementación en el cliente, por pequeña que sea).
    const probes = Array.from(new Set(marketsCents)).sort((a, b) => a - b);
    const rows = probes.map((marketCents) => {
      const d = { sale: explainSaleFromCurve(marketCents, normalizedDraft), buy: explainBuyFromCurve(marketCents, normalizedDraft) };
      const v = { sale: explainSaleFromCurve(marketCents, saved), buy: explainBuyFromCurve(marketCents, saved) };
      const delta = (a: number | null, b: number | null) => (a == null || b == null ? null : a - b);
      return {
        marketCents,
        draft: d,
        saved: v,
        deltaCents: { sale: delta(d.sale.priceCents, v.sale.priceCents), buy: delta(d.buy.priceCents, v.buy.priceCents) },
      };
    });
    // Solo las NO bloqueantes: las bloqueantes ya cortaron con 422 en el controller.
    return { rows, violations: collectCurveViolations(draft).filter((e) => !e.blocking) };
  }

  // v2.0 (P-48, §4.36.2/§4.36.4) — `loadBuylistRules()`, `loadSalesRules()` y `loadTierMap()`
  // RETIRADOS: las cinco claves que leían (`buylist_price_rules`, `buylist_price_fallback_pct`,
  // `sales_price_rules`, `sales_price_fallback_pct`, `pricing_tier_map`) ya no se leen, escriben ni
  // siembran. Las sustituye `loadPricingCurve()` (arriba), ÚNICO lector de configuración de dinero.
  // Sus filas quedan huérfanas e inertes en `ConfigSetting` a propósito (§4.36.9b): borrar config en
  // el mismo paso que cambia la matemática elimina la vía de diagnóstico y el rollback barato.

  /**
   * v1.23-sealed-sales (§4.23b/§4.23c/§4.23d) — CONTEXTO de precio del SELLADO izado en UNA lectura
   * por request (mecanismo INDEPENDIENTE de la curva de precios, pago mínimo de BE-25): spreads por
   * presentación + fallback + estado del dial `sealedPriceSource`. `sourceOn=false` (dial off) ⇒ el
   * sellado solo se vende con override manual (el `sealedMarketRef` queda inerte, ARCHITECTURE §4.23a).
   */
  async loadSealedSpreads(): Promise<{
    spreadPctBySubtype: Record<string, number>;
    fallbackPct: number;
    sourceOn: boolean;
  }> {
    const spreadPctBySubtype =
      ((await this.settings.getRaw(SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE)) as Record<
        string,
        number
      > | null) ?? {};
    const fallbackPct = await this.settings.getNumber(SettingKey.SEALED_SPREAD_FALLBACK_PCT);
    const sourceOn = (await this.settings.getString(SettingKey.SEALED_PRICE_SOURCE)) === 'tcgcsv';
    return { spreadPctBySubtype, fallbackPct, sourceOn };
  }

  /**
   * v1.44-graded-estimate (§4.38c/d) — CONFIG del «gancho de grading» izada UNA vez por request
   * (espejo de `loadSealedSpreads`, pago mínimo de BE-25). Lectura FAIL-CLOSED en dos niveles:
   *
   * 1. **Dial primero:** con `grading_hook_enabled != 'on'` (v1.51, dial ÚNICO) se devuelve la config
   *    APAGADA (y el caller NO lee precios: con el dial `off` el backend «ni siquiera evalúa nada»,
   *    §M10).
   * 2. **`AUSENTE ≠ INVÁLIDA` (GU-A8, v1.44.1).** Tres estados por clave, no dos:
   *
   *    | Estado | `grading_cost_tiers` | `minUpsidePct` / `freshnessDays` / `grades` / `highlightGrades` |
   *    |---|---|---|
   *    | Válida | se usa | se usa |
   *    | **AUSENTE** | tabla VACÍA ⇒ nada se destaca | **seed** (es el estado del primer deploy antes de M-41) |
   *    | **PRESENTE pero INVÁLIDA** | tabla VACÍA ⇒ nada se destaca | **nada se destaca** (NO cae al seed) |
   *
   *    Un valor **corrupto** es evidencia de que la intención del admin **se perdió**, así que no se
   *    adivina. Caer al seed sería *más permisivo que su intención, en silencio*: con la tabla válida y
   *    `grading_min_upside_pct` corrupto, un 200 configurado se volvía el seed 30. Nunca hay default de
   *    código para el COSTO, en ningún estado.
   *
   *
   * **v1.44 R1 — por qué `getRawMany` y no `getRaw`:** `SettingsService.get()/getRaw()` hacen fallback a
   * `SETTING_DEFAULTS`, así que **no distinguen clave AUSENTE de clave presente con el valor del seed**.
   * Con `getRaw` la doctrina (2) era falsa para el caso «ausente»: el resolver veía la tabla completa de
   * 6 escalones y el gate corría normal. `getRawMany` devuelve **solo las filas existentes**, que es la
   * distinción que §4.38d exige. (En una BD sembrada — `prisma/seed.ts` escribe una fila por cada
   * `SETTING_DEFAULTS` — el comportamiento observable no cambia; lo que cambia es el caso degradado.)
   *
   * **v1.44 IMPORTANTE-2 — coste real:** las **11** claves (v1.51: eran 12) se leen en **UNA** query (antes: 1
   * `findUnique` del dial + N `getRaw()` sin caché). El coste del gancho por request queda en **+1
   * query con el dial `off`** y **+3 con `on`** (esta + el batch de estimados de §4.38c + el batch de
   * slabs publicados de INV-D §4.38l). Sigue siendo O(1) respecto del tamaño de la página.
   */
  async loadGradedEstimateConfig(): Promise<GradedEstimateConfig> {
    const raw = await this.settings.getRawMany(GRADED_ESTIMATE_SETTING_KEYS);
    // Config apagada INERTE — con `grades`/`gradingCostTiers` vacíos, las puras devuelven `[]` y
    // `FEATURE_OFF` aunque alguien las llamara por error.
    if (!gradingHookEnabledFrom(raw)) {
      // La constante compartida `DISABLED_GRADED_ESTIMATE_CONFIG` (common/) — una sola definición del
      // estado apagado, para que añadir un dial no deje tres copias divergentes.
      // v1.51 (M-46): se devuelve TAL CUAL. Antes había que reinyectar `ingestEnabled` porque el ingest
      // tenía dial propio; con un solo dial, apagado es apagado en las dos superficies.
      return DISABLED_GRADED_ESTIMATE_CONFIG;
    }
    return this.buildGradedEstimateConfig(raw, true);
  }

  /**
   * v1.44 — variante para las superficies de ADMIN (`GET/PUT /admin/pricing/graded-estimates` y su
   * `/preview`): lee la config COMPLETA **aunque el interruptor maestro esté apagado**, porque el editor
   * de M2 tiene que poder ver y editar los escalones antes de encender la feature, y el diagnóstico
   * tiene que poder explicar `FEATURE_OFF` mostrando la tabla vigente. `enabled` es el ESPEJO
   * READ-ONLY del dial M10 (se edita en `PUT /admin/settings`, no aquí).
   *
   * **v1.51 (M-46, §4.38r.7): es también la vía del GATE DEL INGEST**, que lee `cfg.enabled` — el dial
   * crudo — precisamente porque esta variante NO apaga por claves de curaduría corruptas.
   *
   * Devuelve la config **EFECTIVA** (la misma que ve el resolver): si la fila de `grading_cost_tiers`
   * NO existe, el editor ve `[]` — que es exactamente lo que el gate aplicaría — y no una tabla
   * fantasma que nadie escribió nunca.
   */
  async loadGradedEstimateConfigForAdmin(): Promise<GradedEstimateConfig> {
    const raw = await this.settings.getRawMany(GRADED_ESTIMATE_SETTING_KEYS);
    return this.buildGradedEstimateConfig(raw, gradingHookEnabledFrom(raw));
  }

  /**
   * SANEA las 5 claves de config del gancho ya leídas, aplicando la regla `AUSENTE ≠ INVÁLIDA`
   * (GU-A8, §4.38d). Ver la tabla de tres estados en el docstring de `loadGradedEstimateConfig`.
   *
   * `enabled` es el ESPEJO del dial M10 y **no** lo apaga una clave corrupta (el contrato lo define
   * así); lo que se apaga son `estimatesEnabled` / `highlightEnabled`, y el admin se entera por el
   * `warn` y por el `reason: FEATURE_OFF` del preview.
   */
  private buildGradedEstimateConfig(
    raw: Map<SettingKeyType, unknown>,
    enabled: boolean,
  ): GradedEstimateConfig {
    /**
     * Resuelve UNA clave a sus tres estados. `invalid: true` significa **presente pero inválida**:
     * el valor devuelto es el seed (para que el DTO de admin siga siendo mostrable y tipado), pero el
     * caller **apaga la superficie** en vez de usarlo — que es justo lo contrario de caer al seed.
     */
    const resolve = <T>(
      key: SettingKeyType,
      validate: (v: unknown) => string | null,
    ): { value: T; invalid: boolean } => {
      const seed = SETTING_DEFAULTS[key] as T;
      if (!raw.has(key)) return { value: seed, invalid: false }; // AUSENTE ⇒ seed (deliberado).
      const stored = raw.get(key);
      const err = validate(stored);
      if (err == null) return { value: stored as T, invalid: false }; // VÁLIDA.
      this.warnInvalidGradedEstimateKey(key, err); // PRESENTE pero INVÁLIDA ⇒ apagar, no adivinar.
      return { value: seed, invalid: true };
    };

    const gradesRes = resolve<string[]>(SettingKey.GRADED_ESTIMATE_GRADES, validateGradeList);
    const highlightRes = resolve<string[]>(
      SettingKey.GRADED_ESTIMATE_HIGHLIGHT_GRADES,
      validateGradeList,
    );
    const freshRes = resolve<number>(
      SettingKey.GRADED_ESTIMATE_FRESHNESS_DAYS,
      validateGradedEstimateFreshnessDays,
    );
    const minUpsideRes = resolve<number>(
      SettingKey.GRADING_MIN_UPSIDE_PCT,
      validateGradingMinUpsidePct,
    );
    // v1.50.2 — las 5 claves nuevas, con la MISMA regla de tres estados (AUSENTE ≠ INVÁLIDA).
    const manualFreshRes = resolve<number | null>(
      SettingKey.GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS,
      validateGradedEstimateManualFreshnessDays,
    );
    const maxMultipleRes = resolve<number>(
      SettingKey.GRADED_ESTIMATE_MAX_RAW_MULTIPLE,
      validateGradedEstimateMaxRawMultiple,
    );
    const minSampleRes = resolve<number>(
      SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT,
      validateGradedEstimateMinSampleCount,
    );
    const sourceStatRes = resolve<GradedEstimateSourceStat>(
      SettingKey.GRADED_ESTIMATE_SOURCE_STAT,
      validateGradedEstimateSourceStat,
    );
    const ingestMaxRes = resolve<number>(
      SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN,
      validateGradedEstimateIngestMaxCards,
    );

    // COSTO: se lee del Map SIN consultar `SETTING_DEFAULTS` en NINGÚN estado. Ausente ⇒ `undefined`,
    // corrupta ⇒ el valor tal cual; el saneador devuelve `[]` en ambos casos (money-safe, §4.38d).
    // Su corrupción NO necesita apagar nada: la tabla vacía ya produce `NO_COST_TIER`, que es un
    // diagnóstico MÁS preciso que `FEATURE_OFF` y con el mismo efecto (nada se destaca).
    const tiersRaw = raw.get(SettingKey.GRADING_COST_TIERS);
    if (tiersRaw !== undefined) {
      const tiersErr = validateGradingCostTiers(tiersRaw);
      if (tiersErr) this.warnInvalidGradedEstimateKey(SettingKey.GRADING_COST_TIERS, tiersErr.message);
    }

    const grades = gradesRes.value;
    // `highlightGrades ⊆ grades` (I7) también EN LECTURA: si una edición fuera de banda dejó un grado
    // huérfano, el badge no puede pintar un grado que la ficha no expone.
    const highlightGrades = highlightRes.value.filter((g) => grades.includes(g));

    // Alcance del apagado (§4.38d): `grades`/`freshnessDays` gobiernan TAMBIÉN la ficha — sin umbral de
    // frescura confiable no se puede afirmar que una cifra esté vigente. `minUpsidePct`/`highlightGrades`
    // solo gobiernan la promoción, así que la ficha sobrevive a su corrupción.
    //
    // v1.50.2 — dónde cae cada clave NUEVA (§4.38d › «Alcance del apagado», y el contrato lo repite):
    //  · `manualFreshnessDays` gobierna la FICHA además de la rejilla (es frescura) ⇒ apaga las dos.
    //  · `maxRawMultiple` NO participa en la ficha (§4.38k.3) ⇒ apaga solo la promoción.
    //  · `minSampleCount`/`sourceStat`/`ingestMaxCardsPerRun` son del INGEST: NO apagan ninguna
    //    superficie de LECTURA (corromperlos no puede vaciar una vitrina cuyo dato ya está escrito).
    //    Lo que hacen es que el INGEST se niegue a escribir — fail-closed en su propia ruta.
    // ⚠️ v1.50.3 (I8-bis, §4.38m) — `manualFreshnessDays == null` significa «el override manual NO
    // decae», y eso **desactiva el criterio 109 para la vía manual**: un número que un humano tecleó una
    // vez puede quedarse en portada para siempre, que es exactamente lo que §O.4 promete que no pasa.
    //
    // Sigue siendo EXPRESABLE (es una decisión legítima del dueño) pero **no puede tomarse en silencio**:
    // misma doctrina que «la vitrina no puede vaciarse en silencio» (§4.38d › Observabilidad). Nótese
    // que NO apaga nada — no es una clave corrupta, es una decisión válida; solo se hace audible.
    if (manualFreshRes.value === null && !manualFreshRes.invalid) {
      this.logger.warn(
        `graded-estimate config: '${SettingKey.GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS}' = null ⇒ el ` +
          'override MANUAL nunca caduca. Esto DESACTIVA el criterio 109 para la vía manual: un estimado ' +
          'capturado a mano puede seguir exhibiéndose indefinidamente. Es una decisión válida, pero ' +
          'deliberada — el seed es 30 días. Ajústalo con PUT /admin/pricing/graded-estimates.',
      );
    }

    // v1.51-b (R1) — las claves del INGEST que están PRESENTES-e-INVÁLIDAS, por NOMBRE y en orden fijo.
    // Son las mismas tres de siempre (`minSampleCount`, `sourceStat`, `ingestMaxCardsPerRun`); lo único
    // nuevo es que el fail-closed deja de ser anónimo: el veredicto del ingest las imprime para que el
    // operador sepa qué corregir en vez de mirar el dial —que está bien— y creer que ése es el problema.
    const ingestInvalidKeys: string[] = [];
    if (minSampleRes.invalid) ingestInvalidKeys.push(SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT);
    if (sourceStatRes.invalid) ingestInvalidKeys.push(SettingKey.GRADED_ESTIMATE_SOURCE_STAT);
    if (ingestMaxRes.invalid) ingestInvalidKeys.push(SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN);

    const estimatesEnabled =
      enabled && !gradesRes.invalid && !freshRes.invalid && !manualFreshRes.invalid;
    const highlightEnabled =
      estimatesEnabled && !minUpsideRes.invalid && !highlightRes.invalid && !maxMultipleRes.invalid;

    return {
      enabled,
      estimatesEnabled,
      highlightEnabled,
      grades,
      highlightGrades,
      freshnessDays: freshRes.value,
      minUpsidePct: minUpsideRes.value,
      gradingCostTiers: sanitizeGradingCostTiers(tiersRaw),
      manualFreshnessDays: manualFreshRes.value,
      maxRawMultiple: maxMultipleRes.value,
      minSampleCount: minSampleRes.value,
      sourceStat: sourceStatRes.value,
      ingestMaxCardsPerRun: ingestMaxRes.value,
      // v1.51-b (R1): la MISMA composición de siempre —las 3 claves del ingest— pero conservando CUÁL
      // falló. `ingestConfigInvalid` se deriva de la lista para que no puedan divergir: si mañana
      // alguien recompone una y olvida la otra, la derivación lo impide por construcción.
      ingestConfigInvalid: ingestInvalidKeys.length > 0,
      ingestInvalidKeys,
      // v1.50.3 (§4.38n.3): se expone POR SEPARADO de `highlightEnabled` —que ya está apagado por tres
      // claves distintas— porque la LISTA DE REVISIÓN necesita poder NOMBRAR la clave corrupta en su
      // `409`. Un «algo está mal» no sirve en la superficie que existe para que el operador confíe.
      maxRawMultipleInvalid: maxMultipleRes.invalid,
    };
  }

  /**
   * GU-A8 › Observabilidad (OBLIGATORIA): una clave presente-e-inválida se loguea con `warn`
   * identificando **la clave y el invariante violado**. Un apagado silencioso sería tan malo como el
   * default silencioso que esta regla evita: el dueño debe poder enterarse de por qué se le vació la
   * vitrina. Solo se dispara por edición **fuera de banda** (SQL directo, restore parcial, migración a
   * medias) — el `PUT` de M2 rechaza lo inválido con `422`.
   */
  private warnInvalidGradedEstimateKey(key: SettingKeyType, invariant: string): void {
    this.logger.warn(
      `graded-estimate config: la clave '${key}' está PRESENTE pero es INVÁLIDA (${invariant}). ` +
        'GU-A8 (§4.38d): NO se cae al seed — se apaga la superficie que gobierna. ' +
        'Corrige el valor con PUT /admin/pricing/graded-estimates (o revisa la edición fuera de banda).',
    );
  }

  /**
   * v1.44-graded-estimate (§4.38c) — BATCH DEDICADO de los estimados PSA por carta. **UNA** query,
   * `+1 constante` por request (catálogo, vitrina y ficha); `0` en el resto del sistema.
   *
   * Clave canónica (§4.38a): `(cardId, productType='graded', gradeKey ∈ {graded:PSA:10, graded:PSA:9},
   * finish='normal', cardProductId=null)`. `finish='normal'` SIEMPRE — el grado NO se cruza con el
   * acabado (doctrina ya vigente para `graded`), así que el estimado es **por CARTA**, no por variante.
   *
   * **Por qué un método DEDICADO y NO `getReferencesBatch`:** ese método arma el `WHERE` como PRODUCTO
   * CARTESIANO de los conjuntos distintos (`cardId × productType × gradeKey × finish`) y filtra después
   * en memoria contra `wanted`.
   *
   * *(MERGE v1.50.2 — RANGO CORREGIDO: `getReferencesBatch` está hoy en **`:688-730`** de este archivo
   * — en `main`, antes de la fusión, estaba en `:588-631`; el `:365-408` que citaba esta nota quedó
   * obsoleto hace dos refactors. **La justificación se re-verificó contra el cuerpo actual y sigue
   * siendo literalmente cierta**: el `where` sigue armándose como producto cartesiano de conjuntos y
   * el filtrado exacto sigue haciéndose en memoria contra `wanted`. Se corrige el número, no el
   * argumento.)* Mezclar los ítems raw del listado con los graded del gancho en
   * UNA llamada haría que el SQL trajera `productType in ('raw','graded') × gradeKey in ('raw:NM',
   * 'graded:PSA:10','graded:PSA:9') × finish in (todos)`: un **over-fetch combinatorio** sobre la tabla
   * más caliente del sistema. Un método aparte cuesta +1 query constante y NO toca la ruta de dinero del
   * raw (riesgo de regresión cero).
   *
   * Mismo desempate determinista (`pickBestRef`/`isBetterRef`, que resuelve la precedencia
   * `override manual > ingest` DENTRO de la tabla) y mismo recomputo FX (`liveMxnCents`) que
   * `getReference`. **El valor devuelto NO transporta `source` ni `isManualOverride`**: es la garantía
   * ESTRUCTURAL de que ninguna rama de composición pueda bifurcar por origen del número, y por tanto de
   * que la fase 1 (manual) y la fase 2 (ingest) sean indistinguibles para el cliente (§4.38g).
   *
   * ---
   * ## ⚠️ v1.50.3 (GU-A16, §4.38m) — **PRIMERO se descarta lo rancio, DESPUÉS gana el mejor**
   *
   * ```
   * frescas := candidatas.filter(c => !stale(c, cfg, today))   // 1) el filtro va ANTES
   * si frescas está vacío -> ese grado NO se emite             //    (callar > presumir, §O.4)
   * return pickBestRef(frescas)                                // 2) el manual sigue ganando ENTRE las frescas
   * ```
   *
   * **El fallo que cierra.** Antes se resolvía primero y se filtraba después, así que un override manual
   * de 200 días **ganaba** por tier absoluto (§4.27f-2, correcto) y **luego** la ventana de frescura lo
   * tiraba: la carta acababa **sin estimado pese a haber dato automático fresco disponible**. Fallo
   * silencioso — el dato existía, lo teníamos, y la vitrina se vaciaba sin que nadie se enterara.
   *
   * v1.50.2 lo curó **eximiendo al manual del decaimiento** (`manualFreshnessDays` seed `null`). El
   * diagnóstico era bueno; el remedio, no: derogaba el **criterio 109** en silencio y dejaba un manual de
   * dos años en portada, que es exactamente lo que §O.4 promete que no pasa. **La clase de fallo no venía
   * del decaimiento, venía de filtrar DESPUÉS de resolver.** Invertir el orden la elimina sin eximir a
   * nadie:
   *
   * | Caso | Antes (v1.50.2) | Ahora (v1.50.3) |
   * |---|---|---|
   * | manual 200 d + automática fresca | **nada** (fallo silencioso) | **la automática fresca** |
   * | manual 200 d, sin automática | el manual de 200 d *(⛔ criterio 109)* | **nada** *(✅ criterio 109)* |
   * | manual 5 d + automática 1 d | gana el manual | gana el manual *(sin cambio)* |
   *
   * **`isBetterRef` NO se toca, y eso es el punto.** §4.27f-2 es una garantía **money-safe** sobre
   * ESCRITURAS y sobre el COMPARADOR; el filtro de frescura es un **predicado de exhibición** que vive
   * **fuera** del comparador y **solo** en esta ruta de lectura del gancho (aditiva: `getReference` /
   * `getReferencesBatch` no cambian). El override manual no se borra, no se degrada y no pierde su rango
   * — solo deja de **exhibirse** cuando envejece. Se refresca **recapturándolo**, que convierte «el dueño
   * puso un número una vez» en «el dueño **sostiene** ese número».
   *
   * ---
   * ## ⚠️ v1.50.3-c (QA) — el diagnóstico de admin VE lo que se descartó por rancio
   *
   * **La contrapartida no declarada del arreglo de arriba.** Al mover el filtro DENTRO de este batch, las
   * filas rancias dejaron de existir para todo el que lo consume — incluidos `preview` y `review`, que lo
   * consumen **a propósito** para no diagnosticar sobre una verdad distinta a la del storefront. Efecto
   * medido por QA con una fila manual de 40 días: el diagnóstico respondía
   * `reason: NO_PSA10, stale: false, psa10MxnCents: null, capturedDate: null` cuando la verdad era **«tu
   * cifra expiró»**. `STALE` y `stale:true` quedaron INALCANZABLES en las dos superficies de admin, pese
   * a estar normados en API_CONTRACT §M2.
   *
   * **Importa porque los dos remedios son distintos:** «captura una cifra» (no hay nada) vs. «refresca la
   * que tienes» (hay una, caducada). Un diagnóstico que los confunde manda al operador a capturar de cero
   * un número que ya está en la tabla.
   *
   * **Cómo se recupera SIN deshacer el arreglo.** El orden no se toca y la ruta pública no cambia ni un
   * byte: lo rancio se sigue descartando **antes** de `pickBestRef`. Lo único que se añade es que las
   * descartadas se guardan aparte y, **solo con `includeStaleForDiagnostics`**, se re-inyecta la mejor
   * rancia **de las claves que no tienen NINGUNA fila fresca**. Consecuencias, todas queridas:
   *
   * - *«manual 200 d + automática fresca»* ⇒ el diagnóstico sigue viendo **la automática fresca**, igual
   *   que el storefront. La rancia NO se re-inyecta (esa clave tiene fresca) ⇒ **cero divergencia** en el
   *   caso que motivó el arreglo, que es justo donde una divergencia sería intolerable.
   * - *«manual 40 d, sin automática»* ⇒ el storefront no emite nada (criterio 109) y el diagnóstico
   *   responde `STALE` con su `capturedDate` y su monto: la única divergencia posible viene **etiquetada
   *   con la razón que la explica**.
   * - **No puede volver elegible a nadie:** las filas re-inyectadas son rancias por construcción, y
   *   `evaluateGradingHighlight` corta en `STALE` antes de resolver escalón, umbral o cotas. Y si alguien
   *   pasa este mapa a `selectGradedEstimates`, `usable()` vuelve a filtrar por frescura — la ficha no se
   *   puede envenenar desde aquí ni por accidente.
   *
   * @param cfg config del gancho ya izada por el caller (una sola lectura por request) — se exige
   *   EXPLÍCITAMENTE, sin default, para que ninguna superficie pueda leer estimados **sin** el filtro de
   *   frescura por olvidar un parámetro opcional. Un default aquí sería fail-open sobre el criterio 109.
   * @param today fecha de negocio (`YYYY-MM-DD`, CDMX) — la misma que consumen las puras.
   * @param opts.includeStaleForDiagnostics **SOLO superficies de ADMIN** (`preview`, `review`). Es
   *   opt-in y no tiene default a propósito: la ruta pública no puede activarlo por omisión.
   */
  async getGradedEstimatesBatch(
    cardIds: string[],
    cfg: Pick<GradedEstimateConfig, 'freshnessDays' | 'manualFreshnessDays'>,
    today: string,
    opts?: { includeStaleForDiagnostics?: boolean },
  ): Promise<Map<string, GradedEstimateRef[]>> {
    const map = new Map<string, GradedEstimateRef[]>();
    const ids = [...new Set(cardIds)];
    if (ids.length === 0) return map;
    // MONEY-REF-EXEMPT: ruta del GANCHO, no del dinero (§4.38l.4.4B). Es INCLUSIVA a propósito: las
    // filas `market` de cartas SIN slab son la mejor estimación disponible y son las que hacen que la
    // vitrina tenga algo que mostrar; excluirlas la vaciaría en silencio. La seguridad de esta ruta la
    // dan la omisión por slab publicado (l.2) y el gate de confianza.
    const rows = await this.prisma.priceReference.findMany({
      where: {
        cardId: { in: ids },
        productType: 'graded',
        gradeKey: { in: [...GRADED_ESTIMATE_GRADE_KEYS] },
        // §4.38a: el estimado es de la CARTA, no de un CardProduct (§4.27) — se filtra explícitamente.
        finish: 'normal',
        cardProductId: null,
        // ⚠️ v1.50.3-f (M-43, §4.38l.4.4B) — **AQUÍ NO VA `MONEY_REF_WHERE`, Y ES DELIBERADO.** Ésta es
        // la ruta del GANCHO (ficha, rejilla, vitrina, `preview`, `review`), no la del dinero: lee las
        // DOS naturalezas. Las filas `market` capturadas por la pestaña «Gradeadas» de M1 sobre cartas
        // SIN slab son la mejor estimación disponible de lo que valdría esa carta gradeada, y son las
        // que hacen que la vitrina tenga algo que mostrar el día 1; filtrarlas la **vaciaría en
        // silencio** — el modo de fallo que §4.38 persigue en todas partes. La seguridad de esta ruta
        // la dan la omisión por slab publicado ((l.2), intacta) y el gate de confianza, no la
        // naturaleza. Un lector nuevo que copie esta query DEBE copiar también este comentario o
        // añadir el predicado: la excepción es de estas tres superficies, no del método.
      },
      orderBy: { capturedDate: 'desc' },
      select: PRICE_REF_SELECT,
    });
    if (rows.length === 0) return map;
    // FX izada UNA vez por request (no por fila), igual que en `getReferencesBatch`.
    const fx = await this.fxSnapshotSafe();
    const bestFreshByKey = new Map<string, (typeof rows)[number]>();
    // v1.50.3-c: la MEJOR de las DESCARTADAS por frescura, por clave. Solo la consumen `preview` y
    // `review` (`includeStaleForDiagnostics`); en la ruta pública se calcula y se tira.
    const bestStaleByKey = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      // `isManual` se deriva UNA vez por fila y se reusa (antes se calculaba dos veces en este mismo
      // método): las dos señales son SEPARADAS —una fila puede venir marcada manual con un `source`
      // distinto de `manual`—, así que la regla vive en un solo sitio.
      const isManual = r.isManualOverride === true || r.source === 'manual';
      const k = `${r.cardId}|${r.gradeKey}`;
      // ⚠️ v1.50.3 (§4.38m) — PASO 1: se descarta lo RANCIO **antes** de comparar. `isStaleByOrigin` es
      // el MISMO predicado que aplican las puras (`usable()`/`isStaleRef`), así que no hay dos verdades
      // sobre qué es fresco; lo único que cambia es CUÁNDO se aplica.
      const target = isStaleByOrigin(r.capturedDate.toISOString().slice(0, 10), isManual, today, cfg)
        ? bestStaleByKey
        : bestFreshByKey;
      // PASO 2: dentro de CADA cubeta gana el mejor con el comparador de siempre (§4.27f-2 intacto).
      const cur = target.get(k);
      if (cur == null || isBetterRef(r, cur)) target.set(k, r);
    }
    // ⚠️ FALLBACK DE DIAGNÓSTICO (v1.50.3-c) — **solo** si el caller lo pide, y **solo** para las claves
    // que NO tienen ninguna fila fresca. Ver el bloque «El diagnóstico ve...» del docblock.
    if (opts?.includeStaleForDiagnostics === true) {
      for (const [k, r] of bestStaleByKey) if (!bestFreshByKey.has(k)) bestFreshByKey.set(k, r);
    }
    for (const r of bestFreshByKey.values()) {
      const mxnCents = this.liveMxnCents(r, fx);
      // Money-safe: un `<= 0` NO es un estimado (no se emite ni se usa para resolver escalón).
      if (!Number.isInteger(mxnCents) || mxnCents <= 0) continue;
      const gradeValue = r.gradeKey.split(':')[2] ?? '';
      const list = map.get(r.cardId);
      const ref: GradedEstimateRef = {
        gradeValue,
        gradeKey: r.gradeKey,
        mxnCents,
        capturedDate: r.capturedDate.toISOString().slice(0, 10),
        // v1.50.2 (§4.38m): el ORIGEN de la fila que GANÓ la resolución. Solo decide SI el elemento se
        // emite (y con qué ventana de frescura se mide); nunca QUÉ se emite.
        isManual: r.isManualOverride === true || r.source === 'manual',
        // v1.50.3-f (M-43, §4.38l.4.4B): la NATURALEZA de esa misma fila. Viaja **solo** al diagnóstico
        // de admin; ninguna rama de composición del storefront la lee (la indistinguibilidad de fases
        // de (g) sigue intacta) y ninguna decisión de esta ruta depende de ella.
        refKind: r.refKind,
      };
      if (list) list.push(ref);
      else map.set(r.cardId, [ref]);
    }
    return map;
  }

  /**
   * v1.50.2 (§4.38l, INV-D) — GRADOS CON SLAB PUBLICADO por carta. **UNA** query batcheada, nunca una
   * por grupo: es la 3ª (y última) del gancho, la que lleva el coste a **+3 con el dial `on`**.
   *
   * ### Por qué existe (y por qué es dinero, no cosmética)
   * La fila del **estimado** y la **referencia de mercado real de una pieza PSA N publicada** son **LA
   * MISMA FILA** (`cardId` + `productType='graded'` + `gradeKey` + `finish='normal'`). Cuando la carta
   * tiene un slab publicado de ese grado, ese número **alimenta el precio de venta real de esa pieza**.
   * Un «estimado» tecleado ahí **mueve dinero**. La guarda de ESCRITURA (`422`/`409` en el override)
   * impide capturas nuevas; ésta, la de LECTURA, **neutraliza además las filas escritas ANTES de la
   * regla**, que la guarda de escritura por sí sola no puede alcanzar.
   *
   * Devuelve los `gradeValue` (`"10"`, `"9"`), no las claves: es lo que consumen las puras de §4.38c.
   * Solo cuenta inventario **vendible de plataforma** (`ownerType='platform'`, `status='listed'`) — un
   * slab en bóveda de un cliente, o retirado, no es una publicación cuyo precio podamos mover.
   */
  async getPublishedSlabGradesBatch(cardIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    const ids = [...new Set(cardIds)];
    if (ids.length === 0) return map;
    const rows = await this.prisma.inventoryItem.findMany({
      where: {
        cardId: { in: ids },
        productType: 'graded',
        ownerType: 'platform',
        status: 'listed',
        gradingCompany: GRADED_ESTIMATE_COMPANY,
        gradeValue: { in: [...GRADED_ESTIMATE_GRADE_VALUES] },
      },
      select: { cardId: true, gradeValue: true },
      distinct: ['cardId', 'gradeValue'],
    });
    for (const r of rows) {
      if (r.gradeValue == null) continue;
      const list = map.get(r.cardId);
      if (list) {
        if (!list.includes(r.gradeValue)) list.push(r.gradeValue);
      } else {
        map.set(r.cardId, [r.gradeValue]);
      }
    }
    return map;
  }

  /**
   * v1.50.2 (§4.38l.1, INV-D) — GUARDA DE ESCRITURA del override manual con `productType:'graded'`.
   *
   * Devuelve las piezas **publicadas** (plataforma, `listed`) de ese `(cardId, gradingCompany,
   * gradeValue)`. Si hay al menos una, la fila `(cardId,'graded',gradeKey,'normal')` **no es un
   * estimado**: es la referencia de mercado REAL de esas piezas, y escribir un «estimado» ahí les
   * cambiaría el precio de venta. El caller responde `409 GRADED_ESTIMATE_SLAB_PUBLISHED`.
   *
   * El `gradeKey` es la fuente de verdad de la identidad de grado (`graded:<company>:<grade>`), la
   * MISMA que produce `buildGradeKey`: así la guarda no puede desalinearse de la clave que se escribe.
   * Un `gradeKey` con otra forma ⇒ `[]` (no bloquea): la validación de forma es de la ruta, no de esta
   * guarda, y bloquear por no-parsear convertiría un error de forma en un `409` engañoso.
   */
  async publishedSlabsForGradeKey(
    cardId: string,
    gradeKey: string,
    // MEN-C (QA): cliente OPCIONAL para poder correr la guarda DENTRO de una transacción del caller
    // (el `DELETE` de §4.38q la repite ahí para cerrar la ventana TOCTOU entre el pre-vuelo y el
    // borrado). Omitido ⇒ el cliente de siempre: ningún call-site existente cambia.
    client: Pick<Prisma.TransactionClient, 'inventoryItem'> = this.prisma,
  ): Promise<{ id: string }[]> {
    const parts = gradeKey.split(':');
    if (parts.length !== 3 || parts[0] !== 'graded') return [];
    const [, company, gradeValue] = parts;
    if (!company || !gradeValue) return [];
    if (!(GRADING_COMPANY_VALUES as readonly string[]).includes(company)) return [];
    return client.inventoryItem.findMany({
      where: {
        cardId,
        productType: 'graded',
        ownerType: 'platform',
        status: 'listed',
        gradingCompany: company as GradingCompany,
        gradeValue,
      },
      select: { id: true },
    });
  }

  /**
   * gradeKey de la referencia de MERCADO del sellado de UN item (`sealed:tcg:<productId>`), o `null`
   * si el item no está mapeado (sin productId → sin mercado). Lo usan los call-sites que batchean
   * referencias de sellado (grid, bulk-publish, bóveda sellada) para no reinventar la clave.
   */
  sealedMarketGradeKeyForItem(item: { tcgplayerProductId: number | null }): string | null {
    return item.tcgplayerProductId != null ? sealedMarketGradeKey(item.tcgplayerProductId) : null;
  }

  /**
   * v1.23-sealed-sales (§4.23d) — resuelve el `sealedMarketRef` (referencia de mercado TCGCSV) de un
   * item sellado: `PriceReference(cardId, 'sealed', 'sealed:tcg:<productId>', 'normal')`. `null` si no
   * mapeado. Uso SINGLE (los batch usan `getReferencesBatch` con `sealedMarketGradeKeyForItem`).
   */
  async getSealedMarketRef(item: {
    cardId: string;
    tcgplayerProductId: number | null;
  }): Promise<PriceInfo> {
    const gradeKey = this.sealedMarketGradeKeyForItem(item);
    if (gradeKey == null) return { status: 'pending' };
    return this.getReference(item.cardId, 'sealed', gradeKey, 'normal');
  }

  /**
   * v1.24-sealed-dedup (H-1) — GATE money-safe del MERCADO del sellado: UNA sola fuente de verdad
   * para «¿cuánto mercado cuenta?». El `sealedMarketRef` solo cuenta con una fila `priced`
   * (`referenceMxnCents` no-null). Antes este predicado estaba copiado en catálogo, Compra, grid,
   * bulk-publish y valuación (H-1: 4-5 copias divergentes).
   *
   * v1.43 (IMP-C, §4.23a — pseudocódigo normativo) — el dial `sealedPriceSource` gobierna **solo la
   * FUENTE AUTOMÁTICA de mercado** (`source='tcgcsv'`). Un **override manual de mercado**
   * (`isManualOverride=true` / `source='manual'`, «FIJAR PRECIO») es una decisión humana explícita y
   * **NO lo gatea el dial**: devuelve su `referenceMxnCents` con `sourceOn` sea `true` o `false`. La
   * fuente automática sigue gateada: con el dial `off` queda INERTE (`null`, fail-closed). Antes del
   * fix el gate anulaba TODO mercado con `sourceOn=false` (incluido el override manual) ⇒ un sellado
   * con «FIJAR PRECIO» y dial `off` re-caía en `PRICE_PENDING` y re-creaba el pendiente en cada
   * re-publicación (bucle IMP-C cola↔publicar). Money-safe intacto: sin override manual y sin mercado
   * de fuente aplicable ⇒ `null` ⇒ (sin `listPriceCents`) `PRICE_PENDING`, nunca 0.
   */
  gateSealedMarketCents(ref: PriceInfo | undefined | null, sourceOn: boolean): number | null {
    // SEC N-1 (money-safe): `<= 0` se trata como «sin mercado», IGUAL que `null`. Aunque una fila
    // `isManualOverride` no debería nacer con `referenceMxnCents<=0` (los guards del alta/override lo
    // rechazan), un dato legacy/migración/ruta futura con 0 NO debe colarse como mercado válido: el gate
    // devuelve `null` (⇒ PRICE_PENDING) y `computeSealedSalePrice` jamás produce un $0 publicado.
    if (ref?.status !== 'priced' || ref.referenceMxnCents == null || ref.referenceMxnCents <= 0)
      return null;
    // Override manual de mercado: sobrevive al dial (decisión humana explícita, máxima precedencia §K).
    // v2.1.6: el discriminante es `source === 'manual'` — `manualOverride()` SIEMPRE lo escribe así, y
    // el flag paralelo `isManualOverride` se retiró del DTO por redundante (dos nombres para el mismo
    // hecho es cómo se diverge). El flag sigue existiendo en la FILA de BD, que es donde importa.
    if (ref.source === 'manual') return ref.referenceMxnCents;
    // Mercado de fuente automática (tcgcsv): gateado por el dial.
    return sourceOn ? ref.referenceMxnCents : null;
  }

  /**
   * v1.24-sealed-dedup (H-1) — RESOLVER ÚNICO del precio de VENTA del sellado. Encapsula el gate del
   * mercado (`gateSealedMarketCents`) + la pura `computeSealedSalePrice` (precedencia override>0 >
   * mercado×spread(subtype) > mercado×spread(global) > PRICE_PENDING). Devuelve el `SealedSpreadResult`
   * completo (`{ salePriceCents, source, status, appliedSpreadPct }`).
   *
   * Consumidores: catálogo (`toListingDTO`), Compra (`orders.salePriceOf`), grid (`loadPricedSealed`) y
   * bulk-publish (`inventory`). Un solo cuerpo ⇒ los cuatro coinciden SIEMPRE (incluida la regla de
   * override=0). SEC-A1: `listPriceCents`/`sealedSubtype`/`ref` salen de BD, los spreads de
   * ConfigSetting (vía `ctx`, izado una vez por request con `loadSealedSpreads`); nada del DTO del cliente.
   */
  resolveSealedSalePrice(
    item: { listPriceCents: number | null; sealedSubtype: string | null },
    ref: PriceInfo | undefined | null,
    ctx: { spreadPctBySubtype: Record<string, number>; fallbackPct: number; sourceOn: boolean },
  ): SealedSpreadResult {
    const marketCents = this.gateSealedMarketCents(ref, ctx.sourceOn);
    return computeSealedSalePrice(
      item.listPriceCents,
      item.sealedSubtype,
      marketCents,
      ctx.spreadPctBySubtype,
      ctx.fallbackPct,
    );
  }

  /**
   * v1.23-sealed-sales (§4.23d) — precio de VENTA del sellado por presentación (SEC-A1). Lee el
   * contexto de spreads e invoca la pura `computeSealedSalePrice`. `marketMxnCents` = el
   * `sealedMarketRef` YA gateado por el dial (el llamador pasa `null` si `sourceOn=false`).
   */
  async computeSealedSalePriceForItem(
    item: { listPriceCents: number | null; sealedSubtype: string | null },
    marketMxnCents: number | null,
  ): Promise<SealedSpreadResult> {
    const { spreadPctBySubtype, fallbackPct } = await this.loadSealedSpreads();
    return computeSealedSalePrice(
      item.listPriceCents,
      item.sealedSubtype,
      marketMxnCents,
      spreadPctBySubtype,
      fallbackPct,
    );
  }

  /**
   * Sincroniza el precio de una carta (cache diario). Devuelve el PriceInfo.
   * Si no hay precio y no hay override → crea PendingPriceEntry (no descarta).
   */
  async syncCardPrice(
    card: Card,
    productType: ProductType,
    gradeKey: string,
    finish: Finish = 'normal',
    context: 'catalog' | 'portfolio' | 'buylist' | 'inventory' = 'inventory',
    refId?: string,
    // v1.9-set-chart: el `set-price-sync` precia TODO el set destacado (agregación de
    // mercado/marketing, no bóveda). Con `escalate=false` una carta sin precio NO se encola en
    // PendingPriceEntry (ARCHITECTURE §4.12a: no inundar la cola con todo el catálogo del set).
    // Los flujos de bóveda/buylist siguen con el default `true` (nunca se descarta una carta).
    escalate = true,
  ): Promise<PriceInfo> {
    // Cache diario: ¿ya hay fila de hoy para ESTE acabado?
    // v1.29 (M-31): esta ruta (graded/sealed/market genérico) escribe con `cardProductId=null`. Como
    // Prisma no tipa `null` en la clave compuesta, la lectura del día usa `findFirst` con el filtro.
    //
    // ⚠️ v1.50.3-f (M-43) — la fila se lee SIN filtrar por naturaleza **a propósito**, y luego se
    // ramifica. Filtrar aquí por `refKind:'market'` habría sido lo natural y habría estado MAL: la
    // `@@unique` NO incluye `refKind`, así que una fila de estimado del mismo día es INVISIBLE para el
    // filtro pero **sigue ocupando la clave**, y el `create` de abajo reventaría con P2002. Se lee la
    // fila real y se decide con ella delante.
    // MONEY-REF-EXEMPT: declarado y razonado en el comentario de arriba — la fila del día se lee SIN
    // filtrar y se RAMIFICA por `refKind`, porque filtrarla la volvería invisible para el `create` y
    // éste reventaría con P2002 (la `@@unique` no incluye `refKind`).
    const existing = await this.prisma.priceReference.findFirst({
      where: {
        cardId: card.id,
        productType,
        gradeKey,
        finish,
        capturedDate: today(),
        cardProductId: null,
      },
    });
    // M-43 (§4.38l.4.4A): el cache de dinero solo lo sirve una fila de MERCADO. Un estimado del día
    // NO es un precio cacheado — devolverlo aquí sería GE-1 por otra puerta (`price-sync` corre sobre
    // el inventario en bóveda, y para un slab `gradeKeyFor` produce EXACTAMENTE `graded:PSA:<n>`, la
    // clave del estimado).
    if (existing && existing.refKind === 'market') {
      return {
        status: 'priced',
        referenceMxnCents: existing.priceMxnCents,
        source: existing.source as PriceSourceStr,
        capturedDate: existing.capturedDate.toISOString().slice(0, 10),
      };
    }

    const provider = await this.providerFor(productType);
    const quote = provider ? await provider.fetchPrice({ card, productType, gradeKey, finish }) : null;

    if (!quote || (quote.priceUsdCents == null && quote.priceMxnCents == null)) {
      // v1.8-ronda-c FIX: propaga `finish` a la cola de pendientes. Antes se encolaba sin acabado,
      // colapsando `normal`/`holofoil` de la misma carta en UNA entrada al escalar.
      // v1.9-set-chart: `escalate=false` (set-price-sync) NO encola pendientes (§4.12a).
      if (escalate) {
        await this.escalatePending(card.id, productType, gradeKey, context, refId, finish);
      }
      return { status: 'pending' };
    }

    let priceMxnCents: number;
    let priceUsdCents: number | null = null;
    let fxRate: number | null = null;
    let fxBufferPct: number | null = null;
    if (quote.priceMxnCents != null) {
      priceMxnCents = quote.priceMxnCents;
    } else {
      const fx = await this.fx.getCurrent();
      priceUsdCents = quote.priceUsdCents!;
      fxRate = fx.rate;
      fxBufferPct = fx.bufferPct;
      priceMxnCents = usdToMxnCents(priceUsdCents, fx.rate, fx.bufferPct);
    }

    // M-43 (§4.38l.4.3 regla 2) — **la naturaleza solo la SUBE un humano con `intent:"market"`; ningún
    // escritor automático la mueve.** Si la fila del día es un estimado, este barrido NO la pisa (ni la
    // promueve ni la degrada): hace skip + traza y devuelve `pending`, exactamente igual que ya hacía
    // ante un `isManualOverride`. Con `escalate` la pieza entra a la cola de precio pendiente, que es
    // la señal honesta («esta pieza no tiene precio de mercado»), no un precio heredado.
    // Hoy es un camino inalcanzable —no existe ningún proveedor de mercado `graded` (§4.38l.4.6,
    // candado 4: son *stubs* que devuelven `null`)—; se escribe porque el día que exista, el fallo
    // silencioso sería un P2002 en un job y un precio que nadie explica.
    if (existing) {
      this.logger.warn(
        `price-sync: fila de hoy de ${card.id}/${gradeKey}/${finish} es refKind='${existing.refKind}' ` +
          '(no `market`): NO se escribe la referencia de mercado (M-43, §4.38l.4.3). Retira el estimado ' +
          'o fija el precio con POST /admin/pricing/override e intent:"market".',
      );
      if (escalate) {
        await this.escalatePending(card.id, productType, gradeKey, context, refId, finish);
      }
      return { status: 'pending' };
    }
    const ref = await this.prisma.priceReference.create({
      data: {
        cardId: card.id,
        productType,
        gradeKey,
        finish,
        source: quote.source,
        priceUsdCents,
        fxRate,
        fxBufferPct,
        priceMxnCents,
        capturedDate: today(),
        isManualOverride: false,
        // M-43 (§4.38l.4.3): escritor de MERCADO ⇒ `market` EXPLÍCITO. Coincide con el default de la
        // columna, y se escribe igual: la tabla de escritores de (l.4.3) no admite «lo pone el default».
        refKind: 'market',
      },
    });
    return {
      status: 'priced',
      referenceMxnCents: ref.priceMxnCents,
      source: ref.source as PriceSourceStr,
      capturedDate: ref.capturedDate.toISOString().slice(0, 10),
    };
  }

  /**
   * Cola de precio pendiente (transversal: nunca se descarta la carta).
   * v1.8-ronda-c (M-19): la cola es POR ACABADO. `finish` entra a la clave de dedupe y a la fila
   * creada, para que `normal` y `holofoil` de la misma carta sean entradas SEPARADAS.
   */
  async escalatePending(
    cardId: string,
    productType: ProductType,
    gradeKey: string,
    context: 'catalog' | 'portfolio' | 'buylist' | 'inventory',
    refId?: string,
    finish: Finish = 'normal',
    // v1.30 (M-32, §4.29d): productId TCGplayer cuando la línea es un producto SEPARADO. Entra a la
    // clave LÓGICA de dedupe — una entrada de deck_exclusive/promo NO se resuelve al fijar el precio del
    // set_base (money-safe). `null` (default) = base; deja intactos todos los llamadores previos.
    cardProductId: number | null = null,
    // v1.42 (M-40, §4.34a / BLOQ-2b): identidad del SELLADO. Entra a la clave LÓGICA de dedupe (misma
    // mecánica que `finish`/`cardProductId`): dos pendientes de sellado con distinto sealedProductId (ETB
    // vs blíster) son SEPARADAS — resolver el override de uno NO cierra el otro (money-safe). `null`
    // (default) = raw/graded o sellado legacy sin ligar (residual: colapsa bajo 'sealed' hasta curarse).
    sealedProductId: string | null = null,
    // v2.0 (M-41.6, §4.36.5c): POR QUÉ entra a la cola. `no_market` = sin referencia; `premium_at_floor`
    // = guardarraíl. NO entra a la clave de dedupe: si la entrada ya existe con otra razón, se ACTUALIZA
    // (la cola debe reflejar el problema VIGENTE para ser triable, no el de la primera vez).
    reason: PendingReason | null = null,
  ): Promise<string> {
    // v1.26 (④): devuelve el id de la entrada open (creada o preexistente) para que el llamador
    // (bulkPublish) pueble `pendingPriceEntryId` en la línea PRICE_PENDING (deep-link de UI a M2).
    // Sigue siendo idempotente: dedupe por `(cardId, productType, gradeKey, finish, cardProductId,
    // sealedProductId, status='open')` — v1.30 añade `cardProductId`; v1.42 (M-40) añade `sealedProductId`.
    const open = await this.prisma.pendingPriceEntry.findFirst({
      where: { cardId, productType, gradeKey, finish, cardProductId, sealedProductId, status: 'open' },
    });
    if (open) {
      if (reason != null && open.reason !== reason) {
        await this.prisma.pendingPriceEntry.update({ where: { id: open.id }, data: { reason } });
      }
      return open.id;
    }
    const created = await this.prisma.pendingPriceEntry.create({
      data: {
        cardId,
        productType,
        gradeKey,
        finish,
        cardProductId,
        sealedProductId,
        context,
        refId,
        status: 'open',
        reason,
      },
    });
    return created.id;
  }

  /**
   * v2.0 (§4.36.5c) — **SALIDA de la cola, simétrica a la entrada**. Cierra las entradas `open` de esa
   * clave cuando el precio VUELVE a resolver (`basis ∈ {market, override, bounty}`). Es COMPORTAMIENTO
   * NUEVO: hasta v1.44 el ingest no cerraba nada y la cola solo se vaciaba con el override manual.
   *
   * Efecto: cuando el siguiente barrido (`price-ingest`) escribe una `PriceReference` real, la entrada
   * se cierra SOLA en la siguiente resolución (publicación, re-publicación o `publish-all`), sin
   * intervención manual. La vía manual (`POST /admin/pricing/override`) NO cambia.
   *
   * ### v2.1.6 (S48-M1) — se cierra por (VARIANTE, EJE, RAZÓN), no por variante
   *
   * Hasta aquí esto era **context-agnóstico a propósito**, con este argumento (v1.26): «la
   * `PriceReference` es COMPARTIDA por clave, así que si el mercado resolvió, resolvió para las dos
   * caras; cerrar solo la del propio contexto dejaría la otra abierta para siempre».
   *
   * **Ese argumento era válido cuando había UNA sola razón** (`no_market`), que efectivamente depende
   * de un dato compartido. **`premium_at_floor` (v2.0) NO lo es:** depende de constantes **distintas
   * por eje** (`sale.floorCents` vs `buy.binCents`, con V7 garantizando `bin < floor`), así que las
   * dos caras **ya no resuelven juntas**. Con el seed y mercado de MX$10:
   *
   * ```
   * VENTA  → 2500c, basis 'floor',  reason 'premium_at_floor'   (bloqueada)
   * COMPRA →  300c, basis 'market', reason  null                (resuelve)
   * ```
   *
   * …así que un cliente autenticado que mandara esa variante en `POST /buylist/requests` **cerraba la
   * entrada que el eje de VENTA había abierto**. No perdía el bloqueo —el seam re-bloquea y re-escala
   * en el siguiente `publish-all`— pero **perdía el AVISO**, que es justo la entrada que §4.36.5c
   * describe como «la que necesita que el dueño mire». Y el peor momento para que la cola se vacíe
   * sola es el **cut-over**, que es cuando más entradas hay.
   *
   * **Regla nueva, por razón:**
   *  - `no_market` ⇒ se cierra **desde cualquier eje** (el argumento v1.26 sigue intacto: el dato que
   *    faltaba es la `PriceReference`, y es compartida).
   *  - `premium_at_floor` ⇒ se cierra **solo desde el eje que la abrió** (`context`). Que mi eje haya
   *    salido del piso no dice NADA sobre el otro.
   *  - `reason = null` (filas históricas anteriores a M-41) ⇒ como `no_market`: son de cuando esa era
   *    la única razón posible. Preserva el comportamiento v1.26 para lo ya escrito.
   */
  async closePendingForVariant(
    cardId: string,
    productType: ProductType,
    gradeKey: string,
    finish: Finish = 'normal',
    cardProductId: number | null = null,
    sealedProductId: string | null = null,
    // v2.1.6 (S48-M1): eje que CIERRA. Omitirlo conserva el cierre total (vía manual del admin, que
    // arregla el dato de mercado compartido — raíz de las DOS razones).
    context?: 'catalog' | 'portfolio' | 'buylist' | 'inventory',
  ): Promise<number> {
    const res = await this.prisma.pendingPriceEntry.updateMany({
      where: {
        cardId,
        productType,
        gradeKey,
        finish,
        cardProductId,
        sealedProductId,
        status: 'open',
        ...(context
          ? {
              OR: [
                // Dato COMPARTIDO ⇒ resolvió para las dos caras (invariante v1.26, intacto).
                { reason: 'no_market' as const },
                { reason: null },
                // Constante POR EJE ⇒ solo puede cerrarla quien la abrió.
                { reason: 'premium_at_floor' as const, context },
              ],
            }
          : {}),
      },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
    return res.count;
  }

  /**
   * v2.0 (§4.36.5c) — **EL MISMO SEAM que escala CIERRA**. Un solo cuerpo para las dos direcciones:
   *  - `reason != null` ⇒ escala (o actualiza la razón de la entrada abierta) y devuelve su id;
   *  - `reason == null` ⇒ cierra las entradas `open` de esa clave y devuelve `undefined`.
   *
   * Tenerlo en UNA función es lo que impide que la salida se olvide en un call-site (que es
   * exactamente lo que pasó hasta ahora: había entrada y no había salida).
   */
  async settlePendingForVariant(
    reason: PendingReason | null,
    key: {
      cardId: string;
      productType: ProductType;
      gradeKey: string;
      finish?: Finish;
      cardProductId?: number | null;
      sealedProductId?: string | null;
    },
    context: 'catalog' | 'portfolio' | 'buylist' | 'inventory',
    refId?: string,
  ): Promise<string | undefined> {
    const finish = key.finish ?? 'normal';
    const cardProductId = key.cardProductId ?? null;
    const sealedProductId = key.sealedProductId ?? null;
    if (reason != null) {
      return this.escalatePending(
        key.cardId,
        key.productType,
        key.gradeKey,
        context,
        refId,
        finish,
        cardProductId,
        sealedProductId,
        reason,
      );
    }
    // v2.1.6 (S48-M1): el EJE viaja al cierre. Sin él, el eje de compra podía apagar el aviso que
    // había abierto el de venta (razones con constantes distintas por eje).
    await this.closePendingForVariant(
      key.cardId,
      key.productType,
      key.gradeKey,
      finish,
      cardProductId,
      sealedProductId,
      context,
    );
    return undefined;
  }

  /**
   * v1.12-catalog-pricing (§4.13a) → GENERALIZADO por WS-A (v1.14-price-ingest, §4.15c/§4.15g).
   * Pobla `PriceReference` de MERCADO de una carta/acabado. Upsert idempotente por día sobre la
   * clave `(cardId, 'raw', 'raw:NM', finish, capturedDate=hoy)`.
   *
   * WS-A: antes hardcodeaba `source='pokemontcg_io'` y asumía USD. Ahora acepta `source`
   * (`PriceSource`) y `currency` para servir también al ingest del proveedor de PAGA:
   *  - `currency==='USD'` → convierte con `usdToMxnCents(market, fx.rate, fx.bufferPct)` (colchón #13),
   *    guarda `priceUsdCents` + `fxRate`/`fxBufferPct` (trazabilidad de la conversión).
   *  - `currency==='MXN'` → SIN conversión ni colchón (el colchón es un cushion del riesgo FX
   *    USD→MXN; si el proveedor ya da MXN no hay FX que amortiguar). `priceUsdCents`/`fx*` = null.
   *
   * - **NO pisa overrides manuales:** si la fila de hoy existe con `isManualOverride=true`, hace
   *   **skip** (el override del admin manda, §4.1).
   * - **NO escala pendientes:** este flujo (catálogo completo) nunca encola `PendingPriceEntry`.
   *   El llamador solo invoca este método cuando hay `market > 0` (validado por el adapter).
   * - **FX pre-cargado:** recibe el snapshot `{ rate, bufferPct }` cargado una sola vez por corrida
   *   (no llama `FxService` por carta) — FX una vez por corrida (§4.15f).
   */
  async persistMarketReference(
    cardId: string,
    finish: Finish,
    market: { marketCents: number; currency: 'USD' | 'MXN'; source: PriceSourceStr },
    fx: { rate: number; bufferPct: number },
    // v1.29 (M-31, §4.27f): el fallback PPT de singles y las gradeadas escriben con `cardProductId=null`
    // (el PRIMARIO tcgcsv_singles por producto lo escribe el CardProductResolver con su cardProductId).
    cardProductId: string | null = null,
  ): Promise<void> {
    const productType: ProductType = 'raw';
    const gradeKey = 'raw:NM';
    const capturedDate = today();
    // v1.29 (M-31): `cardProductId` es `null` en este fallback (PPT/graded). Prisma no tipa `null` en
    // la clave compuesta ⇒ findFirst + update-by-id/create (invariante de un renglón/día por app).
    // MONEY-REF-EXEMPT: lectura de la CLAVE DEL DÍA de un ESCRITOR (mercado raw). Ver arriba.
    const existing = await this.prisma.priceReference.findFirst({
      where: { cardId, productType, gradeKey, finish, capturedDate, cardProductId },
    });
    // No clobbea el override manual del admin (§4.1): si hay override de hoy, se respeta.
    if (existing?.isManualOverride) return;
    const isUsd = market.currency === 'USD';
    const priceMxnCents = isUsd
      ? usdToMxnCents(market.marketCents, fx.rate, fx.bufferPct)
      : market.marketCents;
    const priceUsdCents = isUsd ? market.marketCents : null;
    const fxRate = isUsd ? fx.rate : null;
    const fxBufferPct = isUsd ? fx.bufferPct : null;
    const data = {
      source: market.source,
      priceUsdCents,
      fxRate,
      fxBufferPct,
      priceMxnCents,
      isManualOverride: false,
      // M-43 (§4.38l.4.3) — escritor de MERCADO ⇒ `market`, en el `create` **Y** en el `update`. Aquí
      // `productType`/`gradeKey` están HARDCODEADOS a `raw`/`raw:NM` (§4.38l.4.6, candado 2), así que
      // esta fila nunca puede ser la del estimado; se fija igual porque la regla de (l.4.3) es del
      // ESCRITOR y no admite excepciones «porque en este call-site no puede pasar».
      refKind: PriceRefKind.market,
    };
    if (existing) {
      await this.prisma.priceReference.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.priceReference.create({
        data: {
          cardId,
          productType,
          gradeKey,
          finish,
          capturedDate,
          ...(cardProductId != null ? { cardProductId } : {}),
          ...data,
        },
      });
    }
  }

  /**
   * v1.50.2 (§4.38a INV-FX / §4.38h.4) — ESCRITOR del estimado PSA de la **fase 2** (ingest automático).
   *
   * Escribe la clave canónica del gancho: `(cardId, 'graded', 'graded:PSA:<grade>', finish='normal',
   * cardProductId=null)` — la MISMA fila que lee el storefront y que escribe el override manual.
   *
   * ### INV-FX (NORMATIVO, de dinero) — por qué esto NO es `persistMarketReference` con otro gradeKey
   * Las dos vías de escritura de esta misma fila usan **unidades distintas**:
   *  - **fase 1 (manual)** → `POST /admin/pricing/override` recibe **MXN directo**, sin FX;
   *  - **fase 2 (este método)** → **PPT entrega USD**, así que se persiste `priceUsdCents` + `fxRate`
   *    (+ `fxBufferPct`), exactamente como ya hace `sealed-price-ingest`, y `liveMxnCents` recompone.
   *
   * **Está PROHIBIDO escribir el numeral USD en `priceMxnCents`.** No es pedantería: un PSA 10 de
   * USD 60 guardado como MX$60 queda ~**19× BAJO** —no alto—, así que ninguna cota superior lo ve, y el
   * gate de magnitud tendría que cazarlo aguas abajo por la cota INFERIOR (§4.38k.2). Es más barato
   * prevenirlo en origen. Por eso el `currency` es un parámetro OBLIGATORIO y no un default.
   *
   * Respeta el override MANUAL (§O.6: `override manual > ingest automático`): si la fila del día ya
   * está marcada manual, **no se toca** — misma guarda que `persistMarketReference`.
   *
   * @returns `true` si escribió, `false` si respetó un override manual (para la traza del job).
   */
  async persistGradedEstimateReference(
    cardId: string,
    gradeValue: string,
    market: { amountCents: number; currency: 'USD' | 'MXN'; source: PriceSourceStr },
    fx: { rate: number; bufferPct: number },
  ): Promise<boolean> {
    // Money-safe redundante (el parser ya lo garantiza): un <= 0 NO es un estimado.
    if (!Number.isInteger(market.amountCents) || market.amountCents <= 0) return false;
    const productType: ProductType = 'graded';
    const gradeKey = gradedEstimateGradeKey(gradeValue);
    const finish: Finish = 'normal'; // §4.38a: el grado NO se cruza con el acabado, SIEMPRE `normal`.
    const capturedDate = today();
    // MONEY-REF-EXEMPT: lectura de la CLAVE DEL DÍA del ESCRITOR del ingest de estimados — y es la
    // que sostiene la regla 2 de (l.4.3): necesita VER la fila `market` para hacer skip en vez de
    // degradarla. Con el predicado puesto no la vería y la pisaría, que es el fallo exacto.
    const existing = await this.prisma.priceReference.findFirst({
      where: { cardId, productType, gradeKey, finish, capturedDate, cardProductId: null },
    });
    if (existing?.isManualOverride) return false; // el override manual gana (§O.6).
    // ⚠️ v1.50.3-f (M-43, §4.38l.4.3 regla 2) — **EL INGEST NUNCA DEGRADA UNA FILA `market`.**
    // Si la fila del día ya es una referencia de MERCADO (el precio real de un slab publicado, fijado
    // por un humano con `intent:"market"`), escribir el estimado encima la reclasificaría como
    // `graded_estimate` y **dejaría al slab sin precio** — un fallo silencioso en dirección segura,
    // pero fallo. Skip + traza, exactamente igual que ante `isManualOverride` (misma doctrina (h.4)).
    // Regla general: *la naturaleza solo la SUBE un humano con `intent:"market"`; la automática nunca
    // la baja.* El `return false` es el mismo canal de traza que ya consume el job.
    if (existing != null && existing.refKind === PriceRefKind.market) {
      this.logger.warn(
        `graded-estimate-ingest: SALTADA card=${cardId} PSA ${gradeValue} — la fila de hoy es ` +
          "refKind='market' (referencia de MERCADO de una pieza real): el ingest NO la degrada a " +
          'estimado (M-43, §4.38l.4.3 regla 2).',
      );
      return false;
    }
    const isUsd = market.currency === 'USD';
    const data = {
      source: market.source,
      // INV-FX: el numeral USD va a `priceUsdCents`, JAMÁS a `priceMxnCents`.
      priceUsdCents: isUsd ? market.amountCents : null,
      fxRate: isUsd ? fx.rate : null,
      fxBufferPct: isUsd ? fx.bufferPct : null,
      priceMxnCents: isUsd
        ? usdToMxnCents(market.amountCents, fx.rate, fx.bufferPct)
        : market.amountCents,
      isManualOverride: false,
      // M-43 (§4.38l.4.3): el ingest de fase 2 escribe SIEMPRE `graded_estimate`, en el `create` **Y**
      // en el `update`. El `update` sin esta línea sería el trampolín de la migración por el otro lado:
      // dejaría una fila del gancho clasificada como dinero. (La degradación inversa ya la cortó el
      // `return false` de arriba, así que aquí el `update` solo puede caer sobre otra fila de estimado.)
      refKind: PriceRefKind.graded_estimate,
    };
    if (existing) {
      await this.prisma.priceReference.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.priceReference.create({
        data: { cardId, productType, gradeKey, finish, capturedDate, ...data },
      });
    }
    return true;
  }

  /**
   * v1.26 (P-7 ⑤, ARCHITECTURE §4.24e) — REPRECIO FRESCO on-demand de un puñado de cartas. Orquesta
   * el fetch FRESCO puntual (proveedor PRIMARIO PPT por `tcgplayerId` → FALLBACK pokemontcg.io por
   * `externalId`) + el upsert de `PriceReference` (vía `persistMarketReference`, FX del día). Lo usa
   * `bulkPublish({repriceFresh})` ANTES de resolver el precio, para publicar con una referencia
   * RECIÉN traída (no la almacenada stale).
   *
   * CUOTA (money-safe): CAPA a `MAX_FRESH_REPRICE_CARDS` (nunca barre) y respeta el `dailyLimited`
   * del proveedor de PAGA (para de pedirle; el fallback igual intenta). FALLA-SEGURO: un error de
   * proveedor/FX NUNCA propaga ni inventa un precio — la carta se queda `pending` y el llamador cae a
   * la referencia ALMACENADA (o escala). Solo se persiste una fila con `market > 0`.
   *
   * @param cardIds cartas a repreciar (se deduplican y capan).
   * @param finishes acabados a refrescar; si se omite, se usan los `availableFinishes` de cada carta.
   * @returns `{ refreshed, pending, dailyLimited }` — refreshed = cartas con ≥1 referencia nueva.
   */
  async refreshCardPrices(cardIds: string[], finishes?: Finish[]): Promise<RefreshCardPricesResult> {
    const uniqueIds = [...new Set(cardIds)];
    const capped = uniqueIds.slice(0, MAX_FRESH_REPRICE_CARDS);
    if (capped.length === 0) return { refreshed: [], pending: [], dailyLimited: false };

    const cards = await this.prisma.card.findMany({
      where: { id: { in: capped } },
      select: { id: true, externalId: true, tcgplayerId: true, availableFinishes: true },
    });

    const wantForCard = (avail: Finish[] | null | undefined): Finish[] => {
      if (finishes && finishes.length > 0) return [...new Set(finishes)];
      const a = (avail ?? []) as Finish[];
      return a.length > 0 ? a : ['normal'];
    };
    const refs: FreshCardRef[] = cards.map((c) => ({
      cardId: c.id,
      tcgplayerId: c.tcgplayerId,
      externalId: c.externalId,
      finishes: wantForCard(c.availableFinishes as Finish[]),
    }));

    // FX del día izado UNA vez (money-safe: si falla, solo se persisten filas MXN; las USD se omiten).
    let fx: { rate: number; bufferPct: number } | null = null;
    try {
      const cur = await this.fx.getCurrent();
      if (Number.isFinite(cur.rate) && cur.rate > 0) fx = { rate: cur.rate, bufferPct: cur.bufferPct };
    } catch (e) {
      this.logger.warn(`refreshCardPrices: FX getCurrent falló → solo se persisten filas MXN. ${(e as Error).message}`);
    }

    const refreshed = new Set<string>();
    let dailyLimited = false;
    // Cartas aún sin referencia fresca (para intentarlas con el siguiente proveedor de la cadena).
    let pendingRefs = refs;

    for (const provider of this.freshProviders) {
      if (pendingRefs.length === 0) break;
      let result;
      try {
        result = await provider.fetchFreshForCards(pendingRefs);
      } catch (e) {
        // Un proveedor que revienta NO tumba el reprecio (money-safe): se intenta el siguiente.
        this.logger.warn(`refreshCardPrices: proveedor ${provider.source} falló: ${(e as Error).message}`);
        continue;
      }
      if (result.dailyLimited) dailyLimited = true;
      for (const row of result.rows) {
        if (!(row.marketCents > 0)) continue; // money-safe: nunca 0/negativo.
        if (row.currency === 'USD' && fx == null) continue; // sin FX no se inventa el MXN.
        try {
          await this.persistMarketReference(
            row.cardId,
            row.finish,
            { marketCents: row.marketCents, currency: row.currency, source: row.source },
            fx ?? { rate: 0, bufferPct: 0 }, // fx NO se usa para currency MXN.
          );
          refreshed.add(row.cardId);
        } catch (e) {
          this.logger.warn(`refreshCardPrices: upsert falló para ${row.cardId}/${row.finish}: ${(e as Error).message}`);
        }
      }
      // Solo se reintentan en el fallback las cartas que NO obtuvieron ninguna referencia fresca.
      pendingRefs = pendingRefs.filter((r) => !refreshed.has(r.cardId));
    }

    return {
      refreshed: [...refreshed],
      pending: capped.filter((id) => !refreshed.has(id)),
      dailyLimited,
    };
  }

  /**
   * v1.19-sealed-tcgcsv (§4.19d) — HERMANO de `persistMarketReference` para la referencia de
   * mercado del SELLADO. MISMA doctrina money-safe (upsert idempotente por día, NO clobbea el
   * override manual, NO escala pendientes), con la clave del sellado de mercado:
   * `(cardId=anchorCardId, productType='sealed', gradeKey=sealed:tcg:<productId>, finish='normal',
   * capturedDate=hoy)`, `source='tcgcsv'`.
   *
   * - TCGCSV publica SIEMPRE USD → conversión `usdToMxnCents(market, fx.rate, fx.bufferPct)`
   *   (colchón #13 aplica en cada corrida); se guarda la trazabilidad (`priceUsdCents`, `fxRate`,
   *   `fxBufferPct`).
   * - El gradeKey legacy `'sealed'` (override manual / costo de aportación) NO se toca: dos
   *   productos sellados distintos anclados a la misma Card conviven vía `sealed:tcg:<productId>`.
   * - Esta referencia es INFORMATIVA: no fija `listPriceCents`, no publica, no encola
   *   `PendingPriceEntry` (doctrina §4.19a).
   */
  async persistSealedMarketReference(
    anchorCardId: string,
    tcgplayerProductId: number,
    market: { marketCents: number },
    fx: { rate: number; bufferPct: number },
  ): Promise<void> {
    const productType: ProductType = 'sealed';
    const gradeKey = sealedMarketGradeKey(tcgplayerProductId);
    const finish: Finish = 'normal';
    const capturedDate = today();
    // v1.29 (M-31): sellado no usa CardProduct ⇒ `cardProductId=null` (findFirst + update/create).
    // MONEY-REF-EXEMPT: lectura de la CLAVE DEL DÍA de un ESCRITOR (sellado). No es candidata de
    // precio; filtrar por naturaleza aquí crearía una segunda fila para la misma clave+día.
    const existing = await this.prisma.priceReference.findFirst({
      where: { cardId: anchorCardId, productType, gradeKey, finish, capturedDate, cardProductId: null },
    });
    // No clobbea el override manual del admin (paridad con persistMarketReference, §4.1).
    if (existing?.isManualOverride) return;
    const priceMxnCents = usdToMxnCents(market.marketCents, fx.rate, fx.bufferPct);
    const data = {
      source: 'tcgcsv' as PriceSourceStr,
      priceUsdCents: market.marketCents,
      fxRate: fx.rate,
      fxBufferPct: fx.bufferPct,
      priceMxnCents,
      isManualOverride: false,
      // M-43 (§4.38l.4.3): escritor de MERCADO (sellado) ⇒ `market` en `create` y en `update`.
      refKind: PriceRefKind.market,
    };
    if (existing) {
      await this.prisma.priceReference.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.priceReference.create({
        data: { cardId: anchorCardId, productType, gradeKey, finish, capturedDate, ...data },
      });
    }
  }

  /**
   * Override manual del admin (respaldo siempre disponible). Resuelve pendientes.
   *
   * Envoltorio de compatibilidad de `applyManualOverride`: devuelve **solo** la fila escrita, que es lo
   * único que necesitan los call-sites que no auditan (el alta de sellado, §4.19). Quien necesite el
   * `before` para la bitácora (M-44b) usa `applyManualOverride`.
   */
  async manualOverride(
    cardId: string,
    productType: ProductType,
    gradeKey: string,
    priceMxnCents: number,
    finish: Finish = 'normal',
    // H-1 (SEC): cliente transaccional OPCIONAL. Cuando el override se persiste como parte de una
    // transacción mayor (p. ej. el alta de sellado con precio manual), el caller pasa el `tx` para que
    // la escritura del `PriceReference isManualOverride` (y la resolución de pendientes) participe del
    // MISMO commit/rollback que la creación de la pieza — sin este `tx` el override auto-commiteaba y
    // sobrevivía a un rollback (precio de dinero pinneado huérfano). Ausente ⇒ comportamiento previo.
    tx?: Prisma.TransactionClient,
    // SEC N-3 (money-safe): claves LÓGICAS de dedupe del pendiente (paridad con `escalatePending`). Para
    // sellado LEGACY (gradeKey='sealed' COMPARTIDO por varias identidades) el `updateMany` sin este filtro
    // cerraría TODAS las entradas que comparten (cardId,'sealed',finish) — resolviendo pendientes ajenos.
    // Cuando el caller conoce la identidad, restringe la resolución a la entrada correspondiente. El caso
    // MAPEADO ya segrega por gradeKey='sealed:tcg:<id>', así que no lo necesita. `undefined` (default) o
    // clave ausente ⇒ NO se restringe: retrocompat total del override standalone y de raw/graded.
    pending?: { sealedProductId?: string | null; cardProductId?: number | null },
    // ⚠️ v1.50.3-f (M-43, §4.38l.4.3) — **NATURALEZA de la fila que se escribe.** La fija el `intent`
    // del `POST /admin/pricing/override` (`"market"` ⇒ `market`; `"graded_estimate"` ⇒
    // `graded_estimate`), y con `productType` ≠ `graded` es SIEMPRE `market`.
    //
    // **Por qué el default es `market` aquí y por qué eso NO es fail-open** (la pregunta obvia, dado
    // que §4.38l.1 prohíbe expresamente un `intent` opcional-con-default): el fail-open que aquella
    // regla evita es el del **borde HTTP**, donde un operador puede omitir el campo — y ahí el `intent`
    // sigue siendo OBLIGATORIO (`422 GRADED_INTENT_REQUIRED`, sin default, sin cambios). Este parámetro
    // no es la intención del operador: es la naturaleza YA DECIDIDA por el llamador. Los otros
    // call-sites del servicio (alta de sellado con precio manual, §4.19) escriben `sealed`, que es
    // mercado por definición y no tiene intención que declarar. Un parámetro obligatorio aquí les
    // exigiría afirmar algo que su `productType` ya determina.
    refKind: PriceRefKind = PriceRefKind.market,
  ): Promise<PriceReference> {
    const res = await this.applyManualOverride({
      cardId,
      productType,
      gradeKey,
      priceMxnCents,
      finish,
      tx,
      pending,
      refKind,
    });
    return res.ref;
  }

  /**
   * v1.50.3-g (**M-44** + **M-44b**, §4.38l.4.10) — el override manual, con el `before` que la bitácora
   * necesita y con la guarda de NO-DEGRADACIÓN dentro de la escritura.
   *
   * Devuelve la fila escrita **y** el estado de la fila del día ANTES de escribirla (`null` si no
   * existía). El `before` es requisito de diseño de (l.4.10) punto 5: hasta v1.50.3-f la bitácora de
   * `pricing.override` registraba solo el `after`, así que **el monto pisado no era reconstruible desde
   * el audit trail** — ni el que destruye M-44 (ya imposible) ni el del residual (l.4.9) punto 1, el
   * `intent:"market"` mal tecleado, que sigue siendo un riesgo inherente de cualquier override.
   */
  async applyManualOverride(input: ManualOverrideInput): Promise<ManualOverrideResult> {
    const { cardId, productType, gradeKey, priceMxnCents } = input;
    const finish: Finish = input.finish ?? 'normal';
    const refKind: PriceRefKind = input.refKind ?? PriceRefKind.market;
    const pending = input.pending;
    const db = input.tx ?? this.prisma;
    // v1.29 (M-31): el override manual de MERCADO se guarda con `cardProductId=null` (el precio
    // por-producto es del TCGCSV de singles; el override del admin es genérico por carta). findFirst +
    // update-by-id/create (Prisma no tipa `null` en la clave compuesta).
    const cap = today();
    // MONEY-REF-EXEMPT: es la lectura de la CLAVE DEL DÍA de un ESCRITOR (upsert), no una lectura de
    // candidatas. Filtrar por naturaleza aquí rompería el invariante «una fila por clave+día» (`refKind`
    // NO está en la `@@unique`): dejaría de ver la fila que existe y crearía una segunda.
    const prior = await db.priceReference.findFirst({
      where: { cardId, productType, gradeKey, finish, capturedDate: cap, cardProductId: null },
    });
    // M-44b: la foto de lo que había, tomada dentro del mismo gesto que lo pisa.
    const before: ManualOverrideBefore | null = prior
      ? { priceMxnCents: prior.priceMxnCents, refKind: prior.refKind, source: prior.source }
      : null;
    // ⚠️ M-43 (§4.38l.4.3 regla 1) — `refKind` va en el `update` **igual que en el `create`**, y ésta es
    // LA línea que el dictamen marca como el trampolín de la migración. La `@@unique` NO incluye
    // `refKind`, así que un `intent:"market"` que caiga sobre la fila-estimado del MISMO día reusa esa
    // fila; omitir aquí la naturaleza la dejaría clasificada como estimado y el slab se quedaría **sin
    // precio** — fallo silencioso, en dirección segura, pero fallo. Es además el gesto exacto que exige
    // el paso 3 del cut-over («re-afirmar cada slab con `intent:"market"` ANTES de migrar»), así que sin
    // esta línea el cut-over no funciona.
    const data = { source: 'manual' as const, priceMxnCents, isManualOverride: true, refKind };
    const createData = {
      cardId,
      productType,
      gradeKey,
      finish,
      source: 'manual' as const,
      priceMxnCents,
      capturedDate: cap,
      isManualOverride: true,
      refKind,
    };
    let ref: PriceReference;
    if (!prior) {
      // Sin fila del día no hay nada que degradar: se crea. La carrera contra un `intent:"market"`
      // concurrente NO puede consumar la degradación por este camino — a lo sumo deja las dos filas, y
      // la de MERCADO sigue siendo candidata de dinero (`MONEY_REF_WHERE`), que es el invariante.
      ref = await db.priceReference.create({ data: createData });
    } else if (refKind !== PriceRefKind.graded_estimate) {
      ref = await db.priceReference.update({ where: { id: prior.id }, data });
    } else {
      // ===== M-44 (§4.38l.4.10, NORMATIVO, DINERO) — BAJAR la naturaleza NO es una operación =====
      //
      // La comprobación es **parte de la escritura, no de su antesala** (punto 4 del dictamen): el
      // `updateMany` lleva la naturaleza en su propio `where`, así que entre decidir y confirmar **no
      // hay ventana**. Postgres re-evalúa el predicado sobre la versión ya confirmada de la fila, de
      // modo que un `intent:"market"` concurrente que gane la carrera deja este `updateMany` en
      // `count = 0` en vez de pisarlo. El `if` de abajo es el **pre-vuelo**, y existe solo para dar el
      // mensaje con el monto vigente; quien manda es el `rowcount`.
      if (prior.refKind === PriceRefKind.market) {
        throw degradeMarketRefConflict(cardId, gradeKey, prior, cap);
      }
      const claimed = await db.priceReference.updateMany({
        where: { id: prior.id, refKind: { not: PriceRefKind.market } },
        data,
      });
      // MONEY-REF-EXEMPT: re-lectura POR ID de la fila que este mismo escritor acaba de reclamar; no
      // es una candidata de precio, es el resultado de la escritura.
      const actual = await db.priceReference.findUnique({ where: { id: prior.id } });
      if (claimed.count === 0) {
        // Se perdió la carrera. Si la fila sigue ahí, ahora es de MERCADO: es exactamente la
        // degradación que M-44 prohíbe, y se rechaza igual que en el pre-vuelo.
        if (actual) throw degradeMarketRefConflict(cardId, gradeKey, actual, cap);
        // Si desapareció (el `DELETE` del gancho borra filas `graded_estimate`, §4.38q) no hay dato de
        // dinero que proteger: se crea de nuevo. Un 409 aquí sería mentira.
      }
      ref = actual ?? (await db.priceReference.create({ data: createData }));
    }
    // v1.8-ronda-c FIX: resuelve SOLO el pendiente de ESTE acabado. Antes el where omitía
    // `finish`, así que un override de `normal` cerraba también el pendiente de `holofoil`.
    // SEC N-3: si el caller aporta la identidad (`sealedProductId`/`cardProductId`), se añade al where
    // para cerrar SOLO la entrada correspondiente (clave de dedupe de `escalatePending`).
    await db.pendingPriceEntry.updateMany({
      where: {
        cardId,
        productType,
        gradeKey,
        finish,
        status: 'open',
        ...(pending?.sealedProductId !== undefined
          ? { sealedProductId: pending.sealedProductId }
          : {}),
        ...(pending?.cardProductId !== undefined ? { cardProductId: pending.cardProductId } : {}),
      },
      data: { status: 'resolved', resolvedPriceRefId: ref.id, resolvedAt: new Date() },
    });
    return { ref, before };
  }

  /**
   * Cola de pendientes para M2 (`GET /admin/pricing/pending`).
   * Tier 0 FIX: incluye la carta (con set) — antes el findMany no hacía `include` y el DTO
   * llegaba sin `cardName`, así que el frontend pintaba el UUID. Shape por entrada: todos los
   * campos del modelo `PendingPriceEntry` (incluido `finish`, M-19) + `cardName` (conveniencia
   * plana que consume el front) + `card { id, name, number, setName }`.
   */
  async pendingQueue(context?: 'catalog' | 'portfolio' | 'buylist' | 'inventory', reason?: PendingReason) {
    // P-6 (§M2): filtro opcional por `context` para los dos buckets de M2 (VENTA=`inventory`,
    // COMPRA=`buylist` read-only). Sin arg → todos los pendientes (back-compat). Shape sin cambios.
    // v1.42 (BLOQ-2b): `sealedProduct` para resolver la identidad de display de la cola (cascada §4.34a:
    // SealedProduct vivo → snapshot ausente aquí → Card.name). Presente solo cuando la entrada trae FK.
    const rows = await this.prisma.pendingPriceEntry.findMany({
      // v2.0 (§M2): filtro `?reason=` — `no_market` la cura sola el barrido; `premium_at_floor` necesita
      // que el dueño mire. Omitido = todas (retro-compatible; `null` en filas históricas).
      where: { status: 'open', ...(context ? { context } : {}), ...(reason ? { reason } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { card: { include: { set: true } }, sealedProduct: true },
    });
    // v2.1 (§4.36.5c / API_CONTRACT §M2) — CONTEO POR MOTIVO sobre la cola COMPLETA, en el MISMO
    // snapshot que la lista (encabezado y filas se pintan del mismo `load` ⇒ no pueden contradecirse).
    //
    // ⚠️ NORMATIVO: los counts IGNORAN `?reason=` pero RESPETAN `?context=`. Es la distinción que hace
    // que el número no mienta: `reason` filtra DENTRO de la cola que el dueño está triando, mientras
    // que `context` elige QUÉ COLA ES (VENTA=`inventory` vs COMPRA=`buylist`, §4.24c). Si respetaran
    // `reason`, al filtrar «premium en el piso» el encabezado diría `0 SIN MERCADO` — mentiría justo
    // cuando más se mira. Si ignoraran `context`, el bucket de VENTA sumaría pendientes de COMPRA.
    //
    // Solo `status='open'`: la cola es una BANDEJA DE TRABAJO; una entrada resuelta no es trabajo.
    //
    // Los DOS números juntos son un DIAGNÓSTICO, no dos cifras (§4.36.9c-3): contra la línea base
    // ≈3/333, `premium_at_floor` subiendo con `no_market` PLANO ⇒ PISO MAL CALIBRADO (hay dato y está
    // por debajo del piso); AMBOS subiendo ⇒ FEED DE MERCADO DEGRADADO — y ahí tocar el piso sería
    // tratar el síntoma y empeorar el precio cuando el feed se recupere.
    const grouped = await this.prisma.pendingPriceEntry.groupBy({
      by: ['reason'],
      where: { status: 'open', ...(context ? { context } : {}) },
      _count: { _all: true },
    });
    // `unknown` = filas con `reason=null` (anteriores a M-41). Existe para que valga el invariante
    // `no_market + premium_at_floor + unknown === nº de entradas open de esa cola`: sin ella, una cola
    // con filas históricas no cuadraría con la lista y parecería un bug del backend.
    const counts = { no_market: 0, premium_at_floor: 0, unknown: 0 };
    for (const g of grouped) {
      const key = g.reason ?? 'unknown';
      counts[key as keyof typeof counts] += g._count._all;
    }

    const data = rows.map(({ card, sealedProduct, ...entry }) => ({
      ...entry,
      cardName: card.name,
      card: {
        id: card.id,
        name: card.name,
        number: card.number,
        setName: card.set.name,
      },
      // v1.42 (BLOQ-2b, §4.34a): identidad de sellado presente SOLO para productType='sealed' (ausente en
      // raw/graded). `sealedProductName` RESUELTO por la cascada (SealedProduct vivo → Card.name ancla) para
      // que M2 muestre «ETB …», no «sealed» ambiguo. `sealedProductId`/`sealedSubtype` de la FK viva.
      ...(entry.productType === 'sealed'
        ? {
            sealedProductId: entry.sealedProductId ?? null,
            sealedProductName: sealedProduct?.name ?? card.name,
            sealedSubtype: sealedProduct?.subtype ?? null,
          }
        : {}),
    }));
    return { data, counts };
  }

  async priceHistory(cardId: string): Promise<PriceHistoryEntryDTO[]> {
    // MONEY-REF-EXEMPT: superficie de AUDITORÍA (`priceHistory`, admin-only). `refKind` es aquí
    // justamente el dato que EXPLICA por qué una fila con número no está priciando nada; filtrarla
    // dejaría el historial mudo sobre el caso que más se consulta. §4.38(l.4.4)B.
    const rows = await this.prisma.priceReference.findMany({
      where: { cardId },
      orderBy: { capturedDate: 'desc' },
      // Lista blanca: se selecciona lo que el DTO expone, no la fila entera.
      select: {
        capturedDate: true,
        source: true,
        gradeKey: true,
        productType: true,
        priceMxnCents: true,
        isManualOverride: true,
        // M-43 (§4.38l.4): el historial es la superficie de AUDITORÍA y lee **las dos** naturalezas —
        // NO lleva `MONEY_REF_WHERE`. Ocultar aquí las filas de estimado dejaría al auditor sin poder
        // explicar por qué un slab no tiene precio teniendo una cifra en su clave.
        refKind: true,
      },
    });
    return rows.map(toPriceHistoryEntry);
  }

  // v2.0 (P-48) — `computeSalePrice(ref)` (markup GLOBAL único `SALES_MARKUP_PCT`) RETIRADO: era la
  // palanca de rollback del pricing anterior a v1.13, y con la curva no hay a qué volver. El precio de
  // venta lo resuelve `computeSalePriceForItem` (seam único, §4.36.5b).

  /**
   * v2.0 (P-48, §4.36.5b) — **SEAM ÚNICO DEL EJE DE VENTA**, versión SÍNCRONA (curva ya izada por el
   * caller, patrón BE-25). Devuelve una **DECISIÓN**, no un monto: el precio y el veredicto de
   * publicación salen JUNTOS de la misma llamada.
   *
   * **Por qué la decisión y no el monto (techlead, gate v2.0).** Mientras el seam solo cargaba config y
   * delegaba en la función pura, el guardarraíl vivía FUERA y cada consumidor tenía que acordarse de
   * llamarlo: uno de cinco (`master-set.resolveBuyables`) no se acordó, y el binder ofrecía como
   * `buyable` una premium que el storefront ya ocultaba y el checkout ya rechazaba. La regla «un solo
   * cuerpo» no se sostiene con disciplina; se sostiene con tipos. Aquí es IMPOSIBLE obtener el precio
   * sin recibir el veredicto, y cuando el veredicto bloquea el monto viene en `null`:
   * `pendingReason != null` ⇒ `priceCents === null` y `basis === 'pending'`, sin excepción.
   *
   * **La rareza NO entra al monto (criterio 84).** Entra a `resolvePendingReason`, que devuelve un
   * veredicto —jamás una cantidad— y solo puede SUPRIMIR el precio, nunca fijarlo. La matemática pura
   * de `common/` sigue sin `rarity` ni `finish` en su firma, que es donde §4.36.4 lo exige «hecho tipo».
   *
   * `marketMxnCents` y `curveQuoteCents` se devuelven SIEMPRE (aunque el veredicto bloquee): son la
   * instrumentación honesta del insumo (§4.36.7c) y el diagnóstico del piso mal calibrado que la consola
   * del binder necesita para explicar POR QUÉ se bloqueó.
   */
  decideSalePrice(input: {
    /** Valor de MERCADO de la variante, ya resuelto por el caller (SEC-A1: de BD, jamás del DTO). */
    referenceMxnCents: number | null;
    /**
     * Rareza CANÓNICA — SOLO para el veredicto del guardarraíl (§4.36.5). No entra al monto.
     * Obligatoria (no opcional) A PROPÓSITO: un caller no puede «olvidarla» sin que el compilador lo
     * pare, que es justo la falla que este seam cierra.
     */
    rarityCanonical: string | null;
    /** Fila M-30 de la variante (sellOverrideCents). El `listPriceCents` POR PIEZA lo aplica el caller ANTES. */
    controls?: VariantPriceControls | null;
    /** Curva izada UNA vez por request (BE-25). */
    curve: PricingCurve;
  }): SalePriceDecision {
    // 1. EL MONTO — solo del valor de mercado (§4.36.1): `redondeo↑(max(piso, mercado × markup(mercado)))`,
    //    precedencia `sellOverrideCents > curva > pendiente`. Sin rareza, sin acabado.
    const price = computeSalePriceFromCurve(input.referenceMxnCents, input.curve, input.controls);
    // 2. EL VEREDICTO — `no_market` (sin dato el PISO no gana, decisión LOCKED §4.36.0) o el guardarraíl
    //    `premium_at_floor` (una chase en el piso solo puede significar dato de mercado malo). NO dispara
    //    con `override` ni `bounty`: son decisiones deliberadas del admin y no se corrigen (§4.36.6).
    const pendingReason = resolvePendingReason(price.basis, input.rarityCanonical);
    if (pendingReason != null) {
      // El monto se SUPRIME aquí, en el seam, y no en cada caller: así ninguna superficie puede
      // publicar/cobrar/ofrecer un precio que otra superficie ya considera no publicable.
      return { ...price, priceCents: null, basis: 'pending', pendingReason };
    }
    return { ...price, pendingReason: null };
  }

  /**
   * v2.0 (P-48, §4.36.5b) — el MISMO seam para uso SINGLE: iza la curva por sí mismo cuando el caller
   * no la trae (una sola lectura, `loadPricingCurve`). Delegación pura a `decideSalePrice`: un solo
   * cuerpo, cero matemática propia.
   *
   * Consumidores que DEBEN pasar por aquí o por `decideSalePrice` (§4.36.5b):
   * `catalog.fetchSellable`/`toListingDTO`, `orders.salePriceOf` (checkout auth Y guest),
   * `inventory.bulkPublish`, `publish-all` y el binder de master-set (`resolveBuyables`).
   */
  async computeSalePriceForItem(input: {
    referenceMxnCents: number | null;
    rarityCanonical: string | null;
    controls?: VariantPriceControls | null;
    curve?: PricingCurve;
  }): Promise<SalePriceDecision> {
    const curve = input.curve ?? (await this.loadPricingCurve());
    return this.decideSalePrice({ ...input, curve });
  }

  gradeKeyFor(item: {
    productType: ProductType;
    rawCondition?: string | null;
    gradingCompany?: string | null;
    gradeValue?: string | null;
  }): string {
    return buildGradeKey(item);
  }
}
