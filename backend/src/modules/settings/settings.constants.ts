/**
 * settings.constants.ts — Diales M10 (ConfigSetting). ARCHITECTURE §3.2, §5.1.
 * Los valores viven en DB (editables sin redeploy). Aquí solo las KEYS y los DEFAULTS.
 */
// MERGE v1.50.2: se BORRA `import { TIER_IDS, isTierId } from '../../common/pricing-tiers'` — P-48
// (§4.36.2) retiró `pricing_tier_map` y con él `common/pricing-tiers.ts`. Sus únicos usos en este
// archivo eran el validador de esa clave retirada.
// v1.50-graded-estimate (M-42, §4.38): seeds + validadores del «gancho de grading» viven en la zona
// compartida `common/graded-estimate.ts` (pura, sin infra), igual que `pricing-curve.ts`. Aquí solo se
// cablean como diales.
import {
  DEFAULT_GRADED_ESTIMATE_FRESHNESS_DAYS,
  DEFAULT_GRADED_ESTIMATE_GRADES,
  DEFAULT_GRADED_ESTIMATE_HIGHLIGHT_GRADES,
  DEFAULT_GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN,
  DEFAULT_GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS,
  DEFAULT_GRADED_ESTIMATE_MAX_RAW_MULTIPLE,
  DEFAULT_GRADED_ESTIMATE_MIN_SAMPLE_COUNT,
  DEFAULT_GRADED_ESTIMATE_SOURCE_STAT,
  DEFAULT_GRADING_COST_TIERS,
  DEFAULT_GRADING_MIN_UPSIDE_PCT,
  GRADED_ESTIMATE_FRESHNESS_DAYS_MAX,
  GRADED_ESTIMATE_FRESHNESS_DAYS_MIN,
  GRADED_ESTIMATE_GRADE_VALUES,
  GRADING_MIN_UPSIDE_PCT_MAX,
  validateGradedEstimateIngestMaxCards,
  validateGradedEstimateManualFreshnessDays,
  validateGradedEstimateMaxRawMultiple,
  validateGradedEstimateMinSampleCount,
  validateGradedEstimateSourceStat,
  validateGradingCostTiers,
} from '../../common/graded-estimate';
// v2.0 (P-48, §4.36.2): la CURVA vive en `common/` (zona compartida, sin infra) para que el seed, las
// migraciones y los tests la compartan con el runtime. Aquí solo se declara su KEY, su DEFAULT y su
// validador de puerta; la matemática y los invariantes V1–V8 NO se duplican.
import { DEFAULT_PRICING_CURVE, validatePricingCurve } from '../../common/pricing-curve';
import { SEALED_SUBTYPE_VALUES } from '../../common/enum-values';
export const SettingKey = {
  SHIPPING_FEE_CENTS: 'shipping_fee_cents',
  APORTACION_PCT: 'aportacion_pct',
  IVA_PCT: 'iva_pct',
  SALES_MARKUP_PCT: 'sales_markup_pct',
  STRIPE_FEE_PCT: 'stripe_fee_pct',
  STRIPE_FEE_FIXED_CENTS: 'stripe_fee_fixed_cents',
  // v1.40 (Enmienda A, P-37): el dial `STRIPE_FEE_IVA_PCT` se RETIRA. El IVA que Stripe MX cobra
  // sobre su comisión se deriva ahora de `IVA_PCT` (fuente única; ver settings.service.getStripeFee).
  // La clave de BD `stripe_fee_iva_pct` queda deprecada e inerte (nadie la lee); sin migración.
  BUYLIST_CAP_PER_REQUEST_CENTS: 'buylist_cap_per_request_cents',
  BUYLIST_CAP_PER_MONTH_CENTS: 'buylist_cap_per_month_cents',
  INE_THRESHOLD_CENTS: 'ine_threshold_cents',
  REPO_CAP_PER_CARD_CENTS: 'repo_cap_per_card_cents',
  FX_BUFFER_PCT: 'fx_buffer_pct',
  FX_MANUAL_OVERRIDE_RATE: 'fx_manual_override_rate',
  PRICING_PROVIDER_RAW: 'pricing_provider_raw',
  PRICING_PROVIDER_GRADED: 'pricing_provider_graded',
  PRICING_PROVIDER_SEALED: 'pricing_provider_sealed',
  // v1.14-price-ingest (WS-A, §4.15h): proveedor de la INGESTA MASIVA de precios (BulkPriceProvider).
  // Distinto de los `pricing_provider_*` per-carta de arriba. Palanca de rollback money-safe: seed
  // `pokemontcg_io` (legacy, sin cambio de fuente al desplegar); el humano flipa a
  // `pokemonpricetracker` tras verificar el esquema del proveedor de paga en la 1ª corrida.
  PRICE_PROVIDER: 'price_provider',
  // v1.19-sealed-tcgcsv (§4.19e): dial FAIL-CLOSED de la ingesta de la referencia de mercado
  // del SELLADO vía TCGCSV (job `sealed-price-ingest`). Valores `tcgcsv | off`, seed `off`:
  // al desplegar NO se ingiere nada hasta que devops valide el esquema real en staging y
  // flipee el dial (mismo patrón de rollout money-safe que `price_provider`). Rollback = `off`
  // (los PriceReference ya escritos permanecen, informativos e inertes).
  SEALED_PRICE_SOURCE: 'sealed_price_source',
  // v2.0 (P-48, §4.36.2/§4.36.9b) — RETIRADAS: `buylist_price_rules`, `buylist_price_fallback_pct`,
  // `sales_price_rules`, `sales_price_fallback_pct` y `pricing_tier_map`. Las cinco las reemplaza UNA
  // sola clave, `pricing_curve` (abajo). Ya no se leen, ni se escriben, ni se siembran; sus filas
  // quedan huérfanas e inertes en `ConfigSetting` A PROPÓSITO (no se borran en la migración: borrar
  // config en el mismo paso que cambia la matemática elimina la vía de diagnóstico y el rollback
  // barato). Mismo precedente que `rarity_map` (v1.32).
  // v2.0 (P-48, §4.36.2, M-41.7): LA CURVA — UNA sola clave que reemplaza a las CINCO de arriba
  // (`sales_price_rules`, `sales_price_fallback_pct`, `buylist_price_rules`,
  // `buylist_price_fallback_pct`, `pricing_tier_map`). Es UNA y no dos (venta/compra) a propósito: el
  // invariante «la compra queda por debajo de la venta en todo el dominio» es CRUZADO (depende de las
  // dos curvas + piso + bin a la vez); con dos claves, dos PUT sucesivos abren una ventana en la que se
  // compra por encima de lo que se vende. Con una, la validación es ATÓMICA por construcción.
  // Editable SOLO por `GET/PUT /admin/pricing/curve` (como los spreads del sellado): NO se expone en
  // `SETTING_DTO_MAP`, así que `PUT /admin/settings` no la toca.
  PRICING_CURVE: 'pricing_curve',
  // v1.23-sealed-sales (§4.23c): spreads de VENTA del SELLADO por presentación + fallback global.
  // Mecanismo INDEPENDIENTE de la curva de precios (v2.0, §4.36): el sellado no interpola, usa
  // `pct` = markup ARRIBA de mercado por SealedSubtype (NO % de la referencia como en buylist).
  // Editables por endpoints M2 dedicados (GET/PUT /admin/pricing/sealed-spreads), NO por
  // PUT /admin/settings. money.computeSealedSalePrice.
  SEALED_SPREAD_PCT_BY_SUBTYPE: 'sealed_spread_pct_by_subtype',
  SEALED_SPREAD_FALLBACK_PCT: 'sealed_spread_fallback_pct',
  // v1.23-sealed-sales (§4.23h): feature flags (seed off) de los endpoints §2-S. Con off el
  // endpoint responde 404 FEATURE_DISABLED. Expuestos en el DTO de M10 (sealedValueTrend/
  // sealedRestockAlerts) y editables por PUT /admin/settings (a diferencia de los spreads).
  SEALED_VALUE_TREND: 'sealed_value_trend',
  SEALED_RESTOCK_ALERTS: 'sealed_restock_alerts',
  // Retención de INE (días desde el cierre/pago de la solicitud) antes de purgar imágenes.
  // Dial interno (LFPDPPP): NO se expone en el DTO de M10 hasta que el arquitecto lo
  // formalice en el contrato (ver docs/BACKEND_NOTES.md).
  INE_RETENTION_DAYS: 'ine_retention_days',
  // v1.44-graded-estimate (M-41, §4.38d): «gancho de grading» — SEIS claves, DATA/seed (sin DDL).
  // Las CINCO primeras se editan en M2 (GET/PUT /admin/pricing/graded-estimates), NO por
  // PUT /admin/settings (mismo criterio que los spreads del sellado). `grading_cost_tiers` y
  // `grading_min_upside_pct` gobiernan EXCLUSIVAMENTE la CURADURÍA (teja/vitrina): subir el umbral vacía
  // la vitrina pero la FICHA sigue mostrando sus estimados (partición §4.38-0).
  GRADED_ESTIMATE_GRADES: 'graded_estimate_grades',
  GRADED_ESTIMATE_HIGHLIGHT_GRADES: 'graded_estimate_highlight_grades',
  GRADED_ESTIMATE_FRESHNESS_DAYS: 'graded_estimate_freshness_days',
  GRADING_COST_TIERS: 'grading_cost_tiers',
  GRADING_MIN_UPSIDE_PCT: 'grading_min_upside_pct',
  // Interruptor MAESTRO (M10, seed `off` FAIL-CLOSED): con `off` el backend NI SIQUIERA evalúa el gate.
  // Expuesto en el DTO de M10 y editable por PUT /admin/settings (patrón sealedValueTrend).
  GRADED_ESTIMATES_ENABLED: 'graded_estimates_enabled',
  // ===== v1.50.2 (§4.38k/h) — las 6 claves nuevas: 5 de M2 + el 2º interruptor M10 =====
  // Las cinco de M2 se editan en `PUT /admin/pricing/graded-estimates` (NO aquí, igual que las otras
  // cinco de arriba): el recurso dedicado es el único que puede validar invariantes ENTRE filas.
  GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS: 'graded_estimate_manual_freshness_days',
  GRADED_ESTIMATE_MAX_RAW_MULTIPLE: 'graded_estimate_max_raw_multiple',
  GRADED_ESTIMATE_MIN_SAMPLE_COUNT: 'graded_estimate_min_sample_count',
  GRADED_ESTIMATE_SOURCE_STAT: 'graded_estimate_source_stat',
  GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN: 'graded_estimate_ingest_max_cards_per_run',
  // Segundo interruptor M10 (seed `off` FAIL-CLOSED) — gobierna la OBTENCIÓN (¿gastamos créditos y
  // escribimos filas?), no la EXHIBICIÓN. Son dos diales a propósito (§4.38d): con uno solo, el
  // operador tendría que elegir entre «no puedo probar el ingest sin publicar» y «no puedo publicar
  // sin encender el gasto». Con dos puede rodar el ingest EN OBSERVACIÓN con la vitrina apagada.
  GRADED_ESTIMATE_INGEST_ENABLED: 'graded_estimate_ingest_enabled',
  // v1.1 (M-9): frontera por defecto del sync de catálogo (POST /admin/catalog/sync sin setId).
  // Formato pokemontcg.io `yyyy/MM/dd`. ConfigSetting de primera clase: expuesto en el DTO de
  // M10 (`catalogSyncFromDate`), legible y editable por GET/PUT /admin/settings.
  CATALOG_SYNC_FROM_DATE: 'catalog_sync_from_date',
} as const;

export type SettingKeyType = (typeof SettingKey)[keyof typeof SettingKey];

/** Defaults iniciales (ARCHITECTURE §3.2). Montos en centavos MXN. */
export const SETTING_DEFAULTS: Record<SettingKeyType, unknown> = {
  [SettingKey.SHIPPING_FEE_CENTS]: 17500, // MX$175
  [SettingKey.APORTACION_PCT]: 70,
  [SettingKey.IVA_PCT]: 16,
  [SettingKey.SALES_MARKUP_PCT]: 15, // markup de venta configurable
  [SettingKey.STRIPE_FEE_PCT]: 0.036, // 3.6% tarifa MX Stripe (fracción)
  [SettingKey.STRIPE_FEE_FIXED_CENTS]: 300, // MX$3.00 fija
  // v1.40 (P-37): STRIPE_FEE_IVA_PCT retirado — el IVA de la comisión Stripe deriva de IVA_PCT (16 ⇒ 0.16).
  [SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS]: 300000, // MX$3,000
  [SettingKey.BUYLIST_CAP_PER_MONTH_CENTS]: 1000000, // MX$10,000
  [SettingKey.INE_THRESHOLD_CENTS]: 300000, // = tope por solicitud
  [SettingKey.REPO_CAP_PER_CARD_CENTS]: 5000000, // tope de reposición por carta (editable)
  [SettingKey.FX_BUFFER_PCT]: 3, // colchón FX (%)
  [SettingKey.FX_MANUAL_OVERRIDE_RATE]: null, // sin override por defecto
  [SettingKey.PRICING_PROVIDER_RAW]: 'pokemontcg_io',
  [SettingKey.PRICING_PROVIDER_GRADED]: 'pokemonpricetracker',
  [SettingKey.PRICING_PROVIDER_SEALED]: 'pokemonpricetracker',
  // v1.14-price-ingest (WS-A): SEED `pokemontcg_io` por seguridad (rollout money-safe). El flip a
  // `pokemonpricetracker` lo hace el humano tras verificar el esquema (ARCHITECTURE §4.15h).
  [SettingKey.PRICE_PROVIDER]: 'pokemontcg_io',
  // v1.19-sealed-tcgcsv (§4.19e / §4.23e / API_CONTRACT §M10): SEED `off` (FAIL-CLOSED, por contrato).
  // Un seed FRESCO (BD nueva: CI/dev/prod) arranca con el autoprecio del sellado APAGADO — la ingesta
  // TCGCSV no corre hasta que devops valide el esquema real en staging (§4.23f) y flipee el dial. El
  // AUTOPRECIO que pidió el PO se enciende EN RUNTIME (no por seed): PUT /admin/settings
  // { "sealedPriceSource": "tcgcsv" } (super_admin, auditado) tras la validación-en-staging. Ese PUT es
  // el mecanismo money-safe; rollback = mismo PUT con "off". NO cambiar este seed a `tcgcsv` (violaría el
  // contrato y removería el candado money-safe del que depende la deuda §BE-44(c) de TECH_DEBT.md).
  [SettingKey.SEALED_PRICE_SOURCE]: 'off',
  [SettingKey.INE_RETENTION_DAYS]: 180, // 6 meses por defecto (ajustable por el negocio/legal)
  [SettingKey.CATALOG_SYNC_FROM_DATE]: '2024/01/01', // v1.1: sets de 2024 en adelante
  // v2.0 (P-48, §4.36.2 / M-41.7): SEED = los diales de PROJECT §N.2 VERBATIM. NO se DERIVA de las
  // reglas viejas: la forma vieja (modos excluyentes por rareza/tier/acabado) y la nueva (una función
  // del mercado) son INCONMENSURABLES — cualquier «conversión» sería una interpretación inventada, y el
  // negocio NO está en vivo, así que no hay comportamiento que preservar. Son DIALES: el súper-admin los
  // mueve desde M2 sin redeploy (el upsert del seed no pisa un valor ya editado).
  [SettingKey.PRICING_CURVE]: DEFAULT_PRICING_CURVE,
  // v1.23-sealed-sales (§4.23c, SUP-6): seed confirmado por el PO — markup % arriba de mercado por
  // presentación (ítems chicos → % mayor) y fallback global 25 para piezas sin subtype o subtype
  // sin regla. Editables en M2 (GET/PUT /admin/pricing/sealed-spreads).
  //
  // v2.1.9 — `upc: 18` y `collection: 22`, **elegidos por el dueño** (2026-08-24). El criterio es el
  // que la tabla ya venía usando: **ítem más chico ⇒ % mayor** (box 18 · etb 22 · bundle 25 · tin 30 ·
  // blister 35). Un **UPC** (Ultra Premium Collection) es la pieza **más grande y cara** del catálogo,
  // así que va con **box**; una **collection** es comparable a un **ETB**. Hasta ahora las dos caían al
  // `SEALED_SPREAD_FALLBACK_PCT: 25` — un número que **nadie eligió** para la pieza más cara que
  // vendemos, y que era el síntoma exacto del que salió todo el hilo del enum en v2.1.8.
  //
  // ⚠️ **Es SEMILLA, no migración.** `prisma/seed.ts` upserta con `update: {}` (no pisa lo que el admin
  // ya editó), así que esta fila **sólo aplica a instalaciones LIMPIAS**. Una BD ya sembrada —la local
  // viva y producción cuando exista— conserva su fila de cinco llaves. Llevarlo a un entorno existente
  // es un **paso de runbook operativo**, no un despliegue: `PUT /admin/pricing/sealed-spreads`
  // (`super_admin`, auditado, sin redeploy). Ver `docs/BACKEND_NOTES.md` › «semilla ≠ migración».
  [SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE]: {
    box: 18,
    etb: 22,
    bundle: 25,
    tin: 30,
    blister: 35,
    upc: 18, // pieza más grande y cara del catálogo ⇒ mismo % que box
    collection: 22, // comparable a un ETB
  },
  [SettingKey.SEALED_SPREAD_FALLBACK_PCT]: 25,
  // v1.23-sealed-sales (§4.23h): feature flags cableados pero APAGADOS (seed off). El front llega
  // después; el súper-admin los enciende sin redeploy (PUT /admin/settings).
  [SettingKey.SEALED_VALUE_TREND]: 'off',
  [SettingKey.SEALED_RESTOCK_ALERTS]: 'off',
  // v1.44-graded-estimate (M-41, §4.38d): seed del «gancho de grading». La tabla de escalones y los
  // umbrales viven en `common/graded-estimate.ts` (pura, sin infra) para que seed, validadores y gate
  // compartan UNA sola fuente. `graded_estimates_enabled` arranca en **off** (fail-closed): el código se
  // despliega INVISIBLE hasta que el humano dé el visto bueno al disclaimer (§N.5) — encenderlo NO es
  // decisión de devops.
  [SettingKey.GRADED_ESTIMATE_GRADES]: DEFAULT_GRADED_ESTIMATE_GRADES,
  [SettingKey.GRADED_ESTIMATE_HIGHLIGHT_GRADES]: DEFAULT_GRADED_ESTIMATE_HIGHLIGHT_GRADES,
  [SettingKey.GRADED_ESTIMATE_FRESHNESS_DAYS]: DEFAULT_GRADED_ESTIMATE_FRESHNESS_DAYS,
  [SettingKey.GRADING_COST_TIERS]: DEFAULT_GRADING_COST_TIERS,
  [SettingKey.GRADING_MIN_UPSIDE_PCT]: DEFAULT_GRADING_MIN_UPSIDE_PCT,
  [SettingKey.GRADED_ESTIMATES_ENABLED]: 'off',
  // v1.50.2 — `manualFreshnessDays` arranca en `null` (el override manual NO decae, §4.38m).
  [SettingKey.GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS]: DEFAULT_GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS,
  [SettingKey.GRADED_ESTIMATE_MAX_RAW_MULTIPLE]: DEFAULT_GRADED_ESTIMATE_MAX_RAW_MULTIPLE,
  [SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT]: DEFAULT_GRADED_ESTIMATE_MIN_SAMPLE_COUNT,
  [SettingKey.GRADED_ESTIMATE_SOURCE_STAT]: DEFAULT_GRADED_ESTIMATE_SOURCE_STAT,
  [SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN]:
    DEFAULT_GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN,
  [SettingKey.GRADED_ESTIMATE_INGEST_ENABLED]: 'off',
};

const PROVIDER_VALUES = ['pokemontcg_io', 'pokemonpricetracker', 'poketrace', 'manual'];

/**
 * v1.14-price-ingest (WS-A, §4.15h): valores válidos del dial `price_provider` (BulkPriceProvider).
 * Proveedores de ingest masivo (NO poketrace/manual, que son del pricing per-carta).
 *
 * v1.44 (P-47, §4.38): += `tcgcsv_singles` — PRIMARIO del barrido de singles por-acabado desde TCGCSV
 * (reverse_holo/holofoil con SU marketPrice). El default sigue en `pokemontcg_io` (seed); devops flipea
 * el dial a `tcgcsv_singles` en staging→prod (config/env es de devops, §4.38e). PPT queda como fallback.
 */
export const PRICE_PROVIDER_VALUES = ['pokemontcg_io', 'pokemonpricetracker', 'tcgcsv_singles'];

/**
 * v1.19-sealed-tcgcsv (§4.19e): valores válidos del dial `sealed_price_source` (enum de
 * contrato `SealedPriceSource`; NO es enum de BD). `off` = fail-closed (no se ingiere nada).
 */
export const SEALED_PRICE_SOURCE_VALUES = ['tcgcsv', 'off'];

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v);
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}








/**
 * v2.0 (P-48, §4.36.3) — validador de PUERTA del dial `pricing_curve`. Delega en el ÚNICO validador
 * (`common/pricing-curve.validatePricingCurve`, invariantes V1–V8) y aplana su resultado estructurado al
 * `string | null` que espera `SETTING_VALIDATORS`. El endpoint dedicado `PUT /admin/pricing/curve` usa la
 * forma ESTRUCTURADA para emitir el `422` con su código propio y el `details` que señala QUÉ PUNTO lo
 * rompe (criterio 87); aquí se conserva el mensaje para que ninguna puerta quede más permisiva que la
 * otra (misma doctrina que `validateFxManualOverrideRate`, FX-B2).
 */
export function validatePricingCurveSetting(v: unknown): string | null {
  const problem = validatePricingCurve(v);
  if (problem == null) return null;
  const where =
    problem.details.axis != null && problem.details.index != null
      ? ` [${problem.details.axis}.points[${problem.details.index}]]`
      : problem.details.axis != null
        ? ` [${problem.details.axis}]`
        : '';
  return `${problem.code}: ${problem.message}${where}`;
}






/**
 * v1.23-sealed-sales (§4.23c): tope del spread de venta del sellado. Mismo criterio que el pct de
 * venta (markup arriba de mercado): puede superar 100% (una promo/pieza rara), tope 1000% evita typos.
 * SUP-8: el validador PERMITE `>= 0` (un spread 0 vende a mercado sin margen; el editor M2 lo advierte);
 * no se fuerza `> 0` para no bloquear una promo deliberada.
 */
export const SEALED_SPREAD_PCT_MAX = 1000;

/** Subtipos válidos del sellado (llaves de `sealed_spread_pct_by_subtype`). */
// v2.1.8: DERIVADO del schema. Con la lista de cinco a mano, `PUT /admin/pricing/sealed-spreads`
// devolvía 422 para `upc`/`collection`, así que el dueño NO podía calibrarles spread y salían al
// fallback del 25 % — un UPC es pieza grande, comparable a una box (18 %) o un ETB (22 %).
export const SEALED_SUBTYPE_KEYS: string[] = [...SEALED_SUBTYPE_VALUES];

/**
 * Valida el mapa `sealed_spread_pct_by_subtype`: objeto, cada clave ∈ `SEALED_SUBTYPE_KEYS`, cada
 * value número en `[0, SEALED_SPREAD_PCT_MAX]`. API_CONTRACT §M2 (GET/PUT /admin/pricing/sealed-spreads).
 *
 * ### v2.1.9 (D3-b) — `null` es el SENTINEL DE RETIRO, y NO es `0`
 * Un valor `null` significa **«quita la regla propia de esta presentación; usa `fallbackPct`»** y por
 * eso se ACEPTA aquí (el `PUT` lo traduce a borrar la llave del mapa persistido). Es el mismo sentinel
 * que este §M2 ya usa para el mismo gesto: `tcgplayerProductId: null` **desmapea** un item sellado.
 *
 * ⚠️ **`null` ≠ `0`, y confundirlos es un bug de DINERO.** `0` es un spread **legítimo** (§SUP-8) y
 * significa **vender AL mercado, sin markup**; `null` significa «no tengo regla, usa el global» (hoy
 * 25 %). Un campo VACIADO en la pantalla viaja como `null`, **jamás** como `0` — que pondría esa
 * presentación a precio de mercado sin margen sin que nadie lo pidiera.
 *
 * Se usa para VALIDAR el REQUEST (`SealedSpreadsUpdateRequest`), donde `null` es legal, y también
 * como validador del setting persistido — donde no habrá `null` nunca, porque el `PUT` los consume
 * borrando la llave. Aceptarlo en los dos lados es inocuo y evita un segundo cuerpo de la misma regla.
 */
export function validateSealedSpreads(v: unknown): string | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return 'must be an object map { [subtype]: number }';
  }
  for (const [subtype, value] of Object.entries(v as Record<string, unknown>)) {
    if (!SEALED_SUBTYPE_KEYS.includes(subtype)) {
      return `invalid subtype "${subtype}": must be one of ${SEALED_SUBTYPE_KEYS.join('|')}`;
    }
    // D3-b: `null` = RETIRO de la regla (el PUT borra la llave). Legal y distinto de `0`.
    if (value === null) continue;
    if (!(isNum(value) && value >= 0 && value <= SEALED_SPREAD_PCT_MAX)) {
      return `invalid spread for "${subtype}": must be a number in [0, ${SEALED_SPREAD_PCT_MAX}], or null to remove the rule`;
    }
  }
  return null;
}

/**
 * Valida el fallback `sealed_spread_fallback_pct` (número en `[0, SEALED_SPREAD_PCT_MAX]`).
 *
 * v2.1.9 (D3-b) — **`null` NO se acepta aquí, a diferencia del mapa por presentación.** El global es
 * el respaldo del que dependen TODAS las presentaciones sin regla propia: retirarlo las dejaría sin
 * dónde derivar precio ⇒ `PRICE_PENDING` ⇒ **fuera de la vitrina**. Es una consecuencia de dinero
 * para un gesto que parece de limpieza, así que se corta con un mensaje que dice qué hacer en su
 * lugar: para «no aplicar markup global» el valor correcto es **`0`**, no la ausencia.
 */
export function validateSealedSpreadFallback(v: unknown): string | null {
  if (v === null) {
    return `fallbackPct cannot be removed: it is the fallback every presentation without its own rule depends on (removing it would leave them PRICE_PENDING, i.e. unpublished). Use 0 for "no global markup"`;
  }
  return isNum(v) && v >= 0 && v <= SEALED_SPREAD_PCT_MAX
    ? null
    : `must be a number in [0, ${SEALED_SPREAD_PCT_MAX}]`;
}

/**
 * FX-B1: cota SUPERIOR del override manual `fx_manual_override_rate`. El tipo de cambio real
 * MXN/USD ronda 15-25; 1000 deja ~40-65x de holgura (escenarios extremos) pero ACOTA la valuación:
 * sin techo, un override absurdo (p.ej. 1e9) desborda la columna `Int priceMxnCents` (~2.1e9) en el
 * job `price-ingest` (excepción Prisma = DoS). Mismo patrón que SALES_PCT_MAX / SEALED_SPREAD_PCT_MAX.
 */
export const MAX_FX_MANUAL_OVERRIDE_RATE = 1000;

/**
 * FX-B2: validador ÚNICO del dial `fx_manual_override_rate`, compartido por las DOS puertas que lo
 * escriben (`PUT /admin/settings` vía SETTING_VALIDATORS y `PUT /admin/fx` vía FxController). Regla
 * unificada: `null` (borra el override) o un tipo de cambio FINITO en `(0, MAX_FX_MANUAL_OVERRIDE_RATE]`.
 * Fraccional es válido porque la columna `FxRate.rate` es `Decimal(12,6)`. Ambas puertas aplican
 * EXACTAMENTE este rango; ninguna queda más permisiva que la otra.
 */
export function validateFxManualOverrideRate(v: unknown): string | null {
  return v === null || (isNum(v) && v > 0 && v <= MAX_FX_MANUAL_OVERRIDE_RATE)
    ? null
    : `must be null or a number in (0, ${MAX_FX_MANUAL_OVERRIDE_RATE}]`;
}

/** v1.23-sealed-sales (§4.23h): valores válidos de los feature flags del sellado (on|off). */
export const FEATURE_FLAG_VALUES = ['on', 'off'];

/**
 * v1.44-graded-estimate (I7, §4.38d) — valida una LISTA de grados (`grades` / `highlightGrades`):
 * array de strings ⊆ `{"10","9"}`, NO vacío y sin duplicados. Lista cerrada a propósito: otros grados
 * (PSA <= 8) y otras graduadoras quedan fuera de alcance (§O.1 — era §N.1 antes de que el merge de
 * pricing v2 desplazara el bloque del gancho), y una key desconocida sembraría un
 * grado que el resolver nunca podría leer.
 */
export function validateGradeList(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) {
    return `must be a non-empty array of grades (${GRADED_ESTIMATE_GRADE_VALUES.join('|')})`;
  }
  const seen = new Set<string>();
  for (const g of v) {
    if (typeof g !== 'string' || !GRADED_ESTIMATE_GRADE_VALUES.includes(g)) {
      return `invalid grade "${String(g)}": must be one of ${GRADED_ESTIMATE_GRADE_VALUES.join('|')}`;
    }
    if (seen.has(g)) return `duplicate grade "${g}"`;
    seen.add(g);
  }
  return null;
}

/** v1.44 (I6): `grading_min_upside_pct` = número en [0, 1000] (% de upside exigido por la curaduría). */
export function validateGradingMinUpsidePct(v: unknown): string | null {
  return isNum(v) && v >= 0 && v <= GRADING_MIN_UPSIDE_PCT_MAX
    ? null
    : `must be a number in [0, ${GRADING_MIN_UPSIDE_PCT_MAX}]`;
}

/** v1.44 (I6): `graded_estimate_freshness_days` = entero en [1, 365]. */
export function validateGradedEstimateFreshnessDays(v: unknown): string | null {
  return isInt(v) && v >= GRADED_ESTIMATE_FRESHNESS_DAYS_MIN && v <= GRADED_ESTIMATE_FRESHNESS_DAYS_MAX
    ? null
    : `must be an integer in [${GRADED_ESTIMATE_FRESHNESS_DAYS_MIN}, ${GRADED_ESTIMATE_FRESHNESS_DAYS_MAX}] (days)`;
}

/**
 * Validadores por dial (fix correctness #2). Cada uno devuelve un mensaje de error o
 * `null` si es válido. Rangos coherentes con la matemática de `money.ts` para que un
 * dial mal escrito NO rompa el checkout (NaN / división por cero / negativos).
 */
export const SETTING_VALIDATORS: Record<SettingKeyType, (v: unknown) => string | null> = {
  [SettingKey.SHIPPING_FEE_CENTS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)'),
  [SettingKey.APORTACION_PCT]: (v) => (isNum(v) && v >= 0 && v <= 100 ? null : 'must be a number in [0, 100]'),
  [SettingKey.IVA_PCT]: (v) => (isNum(v) && v >= 0 && v <= 100 ? null : 'must be a number in [0, 100]'),
  [SettingKey.SALES_MARKUP_PCT]: (v) => (isNum(v) && v >= 0 ? null : 'must be a number >= 0'),
  // stripe_fee_pct es una FRACCIÓN en [0,1); si fuera >= 1 el gross-up dividiría por <= 0.
  [SettingKey.STRIPE_FEE_PCT]: (v) => (isNum(v) && v >= 0 && v < 1 ? null : 'must be a fraction in [0, 1)'),
  [SettingKey.STRIPE_FEE_FIXED_CENTS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)'),
  // v1.40 (P-37): STRIPE_FEE_IVA_PCT retirado (deriva de IVA_PCT); ya no hay validador para esa key.
  [SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)'),
  [SettingKey.BUYLIST_CAP_PER_MONTH_CENTS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)'),
  [SettingKey.INE_THRESHOLD_CENTS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)'),
  [SettingKey.REPO_CAP_PER_CARD_CENTS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)'),
  [SettingKey.FX_BUFFER_PCT]: (v) => (isNum(v) && v >= 0 && v <= 100 ? null : 'must be a number in [0, 100]'),
  // override de FX: null (sin override) o un tipo de cambio en (0, MAX] (FX-B1/FX-B2, validador
  // compartido con PUT /admin/fx para que ambas puertas apliquen el mismo rango).
  [SettingKey.FX_MANUAL_OVERRIDE_RATE]: validateFxManualOverrideRate,
  [SettingKey.PRICING_PROVIDER_RAW]: (v) =>
    typeof v === 'string' && PROVIDER_VALUES.includes(v) ? null : `must be one of ${PROVIDER_VALUES.join('|')}`,
  [SettingKey.PRICING_PROVIDER_GRADED]: (v) =>
    typeof v === 'string' && PROVIDER_VALUES.includes(v) ? null : `must be one of ${PROVIDER_VALUES.join('|')}`,
  [SettingKey.PRICING_PROVIDER_SEALED]: (v) =>
    typeof v === 'string' && PROVIDER_VALUES.includes(v) ? null : `must be one of ${PROVIDER_VALUES.join('|')}`,
  // v1.14-price-ingest (WS-A): IsIn(['pokemontcg_io','pokemonpricetracker']) → 422 si otro valor.
  [SettingKey.PRICE_PROVIDER]: (v) =>
    typeof v === 'string' && PRICE_PROVIDER_VALUES.includes(v)
      ? null
      : `must be one of ${PRICE_PROVIDER_VALUES.join('|')}`,
  // v1.19-sealed-tcgcsv (§4.19e): IsIn(['tcgcsv','off']) → 422 VALIDATION_ERROR si otro valor.
  [SettingKey.SEALED_PRICE_SOURCE]: (v) =>
    typeof v === 'string' && SEALED_PRICE_SOURCE_VALUES.includes(v)
      ? null
      : `must be one of ${SEALED_PRICE_SOURCE_VALUES.join('|')}`,
  // v2.0 (P-48, §4.36.3): la CURVA. Editable SOLO por PUT /admin/pricing/curve (no está en
  // SETTING_DTO_MAP), pero se valida igual en esta puerta: V1–V8 money-safe, sin excepción.
  [SettingKey.PRICING_CURVE]: validatePricingCurveSetting,
  // v1.23-sealed-sales (§4.23c/§4.23h): spreads del sellado (editados por M2, no por PUT settings,
  // pero se validan igual) + feature flags on|off.
  [SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE]: validateSealedSpreads,
  [SettingKey.SEALED_SPREAD_FALLBACK_PCT]: validateSealedSpreadFallback,
  [SettingKey.SEALED_VALUE_TREND]: (v) =>
    typeof v === 'string' && FEATURE_FLAG_VALUES.includes(v) ? null : `must be one of ${FEATURE_FLAG_VALUES.join('|')}`,
  [SettingKey.SEALED_RESTOCK_ALERTS]: (v) =>
    typeof v === 'string' && FEATURE_FLAG_VALUES.includes(v) ? null : `must be one of ${FEATURE_FLAG_VALUES.join('|')}`,
  // v1.44-graded-estimate (M-41, §4.38d): los cinco diales de M2 se editan por
  // GET/PUT /admin/pricing/graded-estimates (no por PUT /admin/settings), pero se validan igual —
  // misma doctrina que los spreads del sellado. `grading_cost_tiers` usa el validador COMPARTIDO
  // I1–I5 de `common/graded-estimate.ts` (el mismo que aplica el PUT y la lectura fail-closed).
  [SettingKey.GRADED_ESTIMATE_GRADES]: validateGradeList,
  [SettingKey.GRADED_ESTIMATE_HIGHLIGHT_GRADES]: validateGradeList,
  [SettingKey.GRADED_ESTIMATE_FRESHNESS_DAYS]: validateGradedEstimateFreshnessDays,
  [SettingKey.GRADING_COST_TIERS]: (v) => validateGradingCostTiers(v)?.message ?? null,
  [SettingKey.GRADING_MIN_UPSIDE_PCT]: validateGradingMinUpsidePct,
  // Interruptor maestro (M10): on|off, seed off. Sí editable por PUT /admin/settings.
  [SettingKey.GRADED_ESTIMATES_ENABLED]: (v) =>
    typeof v === 'string' && FEATURE_FLAG_VALUES.includes(v) ? null : `must be one of ${FEATURE_FLAG_VALUES.join('|')}`,
  // v1.50.2 (I8/I9) — MISMOS validadores compartidos que aplica el `PUT` de M2 y la lectura fail-closed
  // del resolver. Una sola verdad por invariante: si divergieran, el `422` y el apagado on-read dirían
  // cosas distintas sobre el mismo valor.
  [SettingKey.GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS]: validateGradedEstimateManualFreshnessDays,
  [SettingKey.GRADED_ESTIMATE_MAX_RAW_MULTIPLE]: validateGradedEstimateMaxRawMultiple,
  [SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT]: validateGradedEstimateMinSampleCount,
  [SettingKey.GRADED_ESTIMATE_SOURCE_STAT]: validateGradedEstimateSourceStat,
  [SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN]: validateGradedEstimateIngestMaxCards,
  // 2º interruptor M10 (seed `off`): on|off, editable por PUT /admin/settings.
  [SettingKey.GRADED_ESTIMATE_INGEST_ENABLED]: (v) =>
    typeof v === 'string' && FEATURE_FLAG_VALUES.includes(v) ? null : `must be one of ${FEATURE_FLAG_VALUES.join('|')}`,
  [SettingKey.INE_RETENTION_DAYS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (days)'),
  // Fecha `yyyy/MM/dd` (formato pokemontcg.io) para la frontera del sync de catálogo.
  [SettingKey.CATALOG_SYNC_FROM_DATE]: (v) =>
    typeof v === 'string' && /^\d{4}\/\d{2}\/\d{2}$/.test(v) ? null : 'must be a date string yyyy/MM/dd',
};

/** Mapea las keys de DB a los nombres camelCase del DTO de M10 (API_CONTRACT §M10). */
export const SETTING_DTO_MAP: Record<string, SettingKeyType> = {
  shippingFeeCents: SettingKey.SHIPPING_FEE_CENTS,
  aportacionPct: SettingKey.APORTACION_PCT,
  ivaPct: SettingKey.IVA_PCT,
  salesMarkupPct: SettingKey.SALES_MARKUP_PCT,
  stripeFeePct: SettingKey.STRIPE_FEE_PCT,
  stripeFeeFixedCents: SettingKey.STRIPE_FEE_FIXED_CENTS,
  // v1.40 (Enmienda A, P-37): `stripeFeeIvaPct` se RETIRA del DTO de §M10. Ya no se expone en GET ni
  // se acepta en PUT (una key `stripeFeeIvaPct` en el body cae en 422 como cualquier key desconocida).
  buylistCapPerRequestCents: SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS,
  buylistCapPerMonthCents: SettingKey.BUYLIST_CAP_PER_MONTH_CENTS,
  ineThresholdCents: SettingKey.INE_THRESHOLD_CENTS,
  repoCapPerCardCents: SettingKey.REPO_CAP_PER_CARD_CENTS,
  fxBufferPct: SettingKey.FX_BUFFER_PCT,
  fxManualOverrideRate: SettingKey.FX_MANUAL_OVERRIDE_RATE,
  pricingProviderRaw: SettingKey.PRICING_PROVIDER_RAW,
  pricingProviderGraded: SettingKey.PRICING_PROVIDER_GRADED,
  pricingProviderSealed: SettingKey.PRICING_PROVIDER_SEALED,
  // v1.14-price-ingest (WS-A, §M10): dial del proveedor de la ingesta masiva de precios.
  priceProvider: SettingKey.PRICE_PROVIDER,
  // v1.19-sealed-tcgcsv (§M10): dial fail-closed de la referencia de mercado del SELLADO.
  sealedPriceSource: SettingKey.SEALED_PRICE_SOURCE,
  // v1.23-sealed-sales (§M10): feature flags del sellado. Los SPREADS (sealed_spread_*) NO se
  // exponen aquí ni se editan por PUT /admin/settings: solo por GET/PUT /admin/pricing/sealed-spreads.
  sealedValueTrend: SettingKey.SEALED_VALUE_TREND,
  sealedRestockAlerts: SettingKey.SEALED_RESTOCK_ALERTS,
  // v1.44-graded-estimate (§M10): interruptor MAESTRO del gancho de grading (seed `off`). El RESTO de
  // la config del gancho (escalones, minUpsidePct, frescura, grados) NO se expone aquí: vive en los
  // endpoints M2 dedicados GET/PUT /admin/pricing/graded-estimates (como los spreads del sellado).
  gradedEstimatesEnabled: SettingKey.GRADED_ESTIMATES_ENABLED,
  // v1.50.2 (§M10): el SEGUNDO interruptor — el del INGEST (fase 2). Ver §4.38d para por qué son dos.
  gradedEstimateIngestEnabled: SettingKey.GRADED_ESTIMATE_INGEST_ENABLED,
  // v1.1: frontera por defecto del sync de catálogo M2 (API_CONTRACT §M10).
  // ConfigSetting de primera clase: legible por GET y editable por PUT (validador yyyy/MM/dd).
  catalogSyncFromDate: SettingKey.CATALOG_SYNC_FROM_DATE,
};
