/**
 * settings.constants.ts — Diales M10 (ConfigSetting). ARCHITECTURE §3.2, §5.1.
 * Los valores viven en DB (editables sin redeploy). Aquí solo las KEYS y los DEFAULTS.
 */
import { TIER_IDS, isTierId } from '../../common/pricing-tiers';
// v1.44-graded-estimate (M-41, §4.35): seeds + validadores del «gancho de grading» viven en la zona
// compartida `common/graded-estimate.ts` (pura, sin infra), igual que `pricing-tiers.ts`. Aquí solo se
// cablean como diales.
import {
  DEFAULT_GRADED_ESTIMATE_FRESHNESS_DAYS,
  DEFAULT_GRADED_ESTIMATE_GRADES,
  DEFAULT_GRADED_ESTIMATE_HIGHLIGHT_GRADES,
  DEFAULT_GRADING_COST_TIERS,
  DEFAULT_GRADING_MIN_UPSIDE_PCT,
  GRADED_ESTIMATE_FRESHNESS_DAYS_MAX,
  GRADED_ESTIMATE_FRESHNESS_DAYS_MIN,
  GRADED_ESTIMATE_GRADE_VALUES,
  GRADING_MIN_UPSIDE_PCT_MAX,
  validateGradingCostTiers,
} from '../../common/graded-estimate';
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
  // v1.3.1 (§E.1): tabla de precio de buylist por RAREZA OFICIAL. Reemplaza `rarity_map` en la
  // ruta de cotización. Editables en M2 (GET/PUT /admin/pricing/buylist-rules), no en M10.
  BUYLIST_PRICE_RULES: 'buylist_price_rules',
  BUYLIST_PRICE_FALLBACK_PCT: 'buylist_price_fallback_pct',
  // v1.13-sales-pricing (§4.14, FASE 2): tabla de precio de VENTA por RAREZA OFICIAL. Reemplaza el
  // markup GLOBAL único (SALES_MARKUP_PCT) en la ruta de venta. Editables en M2 (GET/PUT
  // /admin/pricing/sales-rules), no en M10. `pct` = % ARRIBA de mercado (markup), NO % de la
  // referencia como en buylist (ver money.ts computeSalePriceForRarity).
  SALES_PRICE_RULES: 'sales_price_rules',
  SALES_PRICE_FALLBACK_PCT: 'sales_price_fallback_pct',
  // v1.37 (§4.33b, P-34, M-38): mapa COMPARTIDO `Record<canonicalRarity, TierId>`. Un solo mapa, dos
  // juegos de valores (vive fuera de las dos claves de reglas porque lo comparten compra y venta). Rareza
  // AUSENTE del mapa ⇒ tier por defecto ⇒ fallbackPct (money-safe, nunca $0/bin fijo). Editable por M2
  // (GET/PUT /admin/pricing/tier-map), no por PUT /admin/settings.
  PRICING_TIER_MAP: 'pricing_tier_map',
  // v1.23-sealed-sales (§4.23c): spreads de VENTA del SELLADO por presentación + fallback global.
  // Espejo de SALES_PRICE_RULES/FALLBACK pero keyeados por SealedSubtype. `pct` = markup ARRIBA de
  // mercado (NO % de la referencia como en buylist). Editables por endpoints M2 dedicados
  // (GET/PUT /admin/pricing/sealed-spreads), NO por PUT /admin/settings. money.computeSealedSalePrice.
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
  // v1.44-graded-estimate (M-41, §4.35d): «gancho de grading» — SEIS claves, DATA/seed (sin DDL).
  // Las CINCO primeras se editan en M2 (GET/PUT /admin/pricing/graded-estimates), NO por
  // PUT /admin/settings (mismo criterio que los spreads del sellado). `grading_cost_tiers` y
  // `grading_min_upside_pct` gobiernan EXCLUSIVAMENTE la CURADURÍA (teja/vitrina): subir el umbral vacía
  // la vitrina pero la FICHA sigue mostrando sus estimados (partición §4.35-0).
  GRADED_ESTIMATE_GRADES: 'graded_estimate_grades',
  GRADED_ESTIMATE_HIGHLIGHT_GRADES: 'graded_estimate_highlight_grades',
  GRADED_ESTIMATE_FRESHNESS_DAYS: 'graded_estimate_freshness_days',
  GRADING_COST_TIERS: 'grading_cost_tiers',
  GRADING_MIN_UPSIDE_PCT: 'grading_min_upside_pct',
  // Interruptor MAESTRO (M10, seed `off` FAIL-CLOSED): con `off` el backend NI SIQUIERA evalúa el gate.
  // Expuesto en el DTO de M10 y editable por PUT /admin/settings (patrón sealedValueTrend).
  GRADED_ESTIMATES_ENABLED: 'graded_estimates_enabled',
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
  // v1.29 (§4.28d): seed en DOS EJES que PRESERVA el negocio vigente. Antes plano
  // (Common/Uncommon $0.50 fijo, Reverse Holo $1.50 fijo, resto → fallback 40%); la key sintética
  // «Reverse Holo» (que era un ACABADO, no rareza) migra a `finishRules.reverse_holo`; Common/Uncommon
  // (rarezas) a `rarityRules`. `fallbackPct` vive en el dial separado BUYLIST_PRICE_FALLBACK_PCT.
  // v1.37 (§4.33b/e, M-38): RESHAPE a TIERS. `tierRules` (5 entradas T0–T4) reemplaza `rarityRules`.
  // `finishRules`/`fallbackPct` (dial separado) NO cambian (eje acabado intacto, §4.28d). Reproduce el
  // negocio de COMPRA vigente SALVO T2: T0 fixed $0.50, T1 fixed $1.50 (Uncommon/Reverse — bandera PO
  // DEV-tiers-1), **T2 pct 25% (cambio LOCKED, antes fallback 40%)**, T3/T4 pct 40% (= fallback vigente).
  [SettingKey.BUYLIST_PRICE_RULES]: {
    tierRules: {
      T0: { mode: 'fixed', value: 50 },
      T1: { mode: 'fixed', value: 150 },
      T2: { mode: 'pct', value: 25 },
      T3: { mode: 'pct', value: 40 },
      T4: { mode: 'pct', value: 40 },
    },
    finishRules: {
      reverse_holo: { mode: 'fixed', value: 150 },
    },
  },
  [SettingKey.BUYLIST_PRICE_FALLBACK_PCT]: 40,
  // v1.29 (§4.28d): seed en DOS EJES que reproduce el ejemplo del humano (Common $5, Uncommon $10 por
  // RAREZA; holo/reverse $10 FIJOS por ACABADO; el resto cae al fallback = market × (1 + 15/100)). Las
  // keys sintéticas «Holo»/«Reverse Holo» migran a `finishRules.holofoil`/`finishRules.reverse_holo`.
  // v1.37 (§4.33b/e, M-38): RESHAPE a TIERS (análogo con SalesRule). Reproduce la VENTA vigente: T0/T1 =
  // pisos fijos vigentes de Common/Uncommon ($5 / $10); T2/T3/T4 = pct 15 (= SALES_PRICE_FALLBACK_PCT
  // vigente, markup arriba de mercado). `finishRules` (holofoil/reverse_holo $10 fijos) = las de hoy, SIN
  // cambio (§4.33e). El eje de venta NO entra al invariante premium→pct (un fixed de venta es un piso).
  [SettingKey.SALES_PRICE_RULES]: {
    tierRules: {
      T0: { mode: 'fixed', value: 500 },
      T1: { mode: 'fixed', value: 1000 },
      T2: { mode: 'pct', value: 15 },
      T3: { mode: 'pct', value: 15 },
      T4: { mode: 'pct', value: 15 },
    },
    finishRules: {
      holofoil: { mode: 'fixed', value: 1000 },
      reverse_holo: { mode: 'fixed', value: 1000 },
    },
  },
  // Default 15 = iguala EXACTAMENTE el SALES_MARKUP_PCT vigente → preserva el precio de venta actual
  // (market × 1.15) para toda rareza que caiga al fallback. Solo el piso de bulk cambia.
  [SettingKey.SALES_PRICE_FALLBACK_PCT]: 15,
  // v1.37 (§4.33b/e, M-38): mapa COMPARTIDO rareza canónica → tier (M.2 LOCKED + las 2 canónicas nuevas
  // Mega Rare/Black White Rare → T3). Rareza ausente ⇒ fallbackPct. Editable por PUT /admin/pricing/tier-map.
  [SettingKey.PRICING_TIER_MAP]: {
    Common: 'T0',
    Uncommon: 'T1',
    'Reverse Holo': 'T1',
    Promo: 'T1',
    Rare: 'T2',
    'Rare Holo': 'T2',
    'Double Rare': 'T3',
    'Ultra Rare': 'T3',
    'Illustration Rare': 'T3',
    'Rare Holo EX': 'T3',
    'Rare Holo GX': 'T3',
    'Rare Holo V': 'T3',
    'Rare Holo VMAX': 'T3',
    'Rare Holo VSTAR': 'T3',
    'Rare Holo LV.X': 'T3',
    'Rare Prime': 'T3',
    'Rare BREAK': 'T3',
    LEGEND: 'T3',
    'Amazing Rare': 'T3',
    'Radiant Rare': 'T3',
    'Shiny Rare': 'T3',
    'Trainer Gallery Rare Holo': 'T3',
    'Rare ACE': 'T3',
    'Mega Rare': 'T3',
    'Black White Rare': 'T3',
    'Special Illustration Rare': 'T4',
    'Hyper Rare': 'T4',
    'Secret Rare': 'T4',
    'Gold Rare': 'T4',
  },
  // v1.23-sealed-sales (§4.23c, SUP-6): seed confirmado por el PO — markup % arriba de mercado por
  // presentación (ítems chicos → % mayor) y fallback global 25 para piezas sin subtype o subtype
  // sin regla. Editables en M2 (GET/PUT /admin/pricing/sealed-spreads).
  [SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE]: { box: 18, etb: 22, bundle: 25, tin: 30, blister: 35 },
  [SettingKey.SEALED_SPREAD_FALLBACK_PCT]: 25,
  // v1.23-sealed-sales (§4.23h): feature flags cableados pero APAGADOS (seed off). El front llega
  // después; el súper-admin los enciende sin redeploy (PUT /admin/settings).
  [SettingKey.SEALED_VALUE_TREND]: 'off',
  [SettingKey.SEALED_RESTOCK_ALERTS]: 'off',
  // v1.44-graded-estimate (M-41, §4.35d): seed del «gancho de grading». La tabla de escalones y los
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
};

const PROVIDER_VALUES = ['pokemontcg_io', 'pokemonpricetracker', 'poketrace', 'manual'];

/**
 * v1.14-price-ingest (WS-A, §4.15h): valores válidos del dial `price_provider` (BulkPriceProvider).
 * SOLO los dos proveedores de ingest masivo (NO poketrace/manual, que son del pricing per-carta).
 */
export const PRICE_PROVIDER_VALUES = ['pokemontcg_io', 'pokemonpricetracker'];

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
 * BE-27 (money-safety): COTA SUPERIOR compartida del `value` de una regla `fixed` (centavos MXN).
 * `= MX$1,000,000` en centavos. Sin techo, un `fixed` absurdo (p. ej. 1e12) desbordaría las columnas
 * `*Cents` que son `Int` en Postgres (máx 2_147_483_647 = ~MX$21.4M): al persistir el importe cotizado
 * lanzaría (excepción Prisma = DoS del checkout/cotización). MX$1M deja holgura de sobra para cualquier
 * pieza real y queda MUY por debajo del techo Int32. Mismo patrón que SALES_PCT_MAX / MAX_FX_MANUAL_OVERRIDE_RATE.
 */
export const FIXED_CENTS_MAX = 100_000_000;

/**
 * v1.3.1 (§E.1): valida UNA regla de precio de buylist `{ mode, value }`.
 * fixed → value entero en [0, FIXED_CENTS_MAX] (centavos MXN). pct → value número en [0, 100].
 */
export function isValidBuylistRule(v: unknown): boolean {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as { mode?: unknown; value?: unknown };
  // BE-27: fixed acotado arriba por FIXED_CENTS_MAX (evita overflow Int32 al persistir `*Cents`).
  if (r.mode === 'fixed') return isInt(r.value) && r.value >= 0 && r.value <= FIXED_CENTS_MAX;
  if (r.mode === 'pct') return isNum(r.value) && r.value >= 0 && r.value <= 100;
  return false;
}

/** v1.29 (§4.28d): acabados válidos como key de `finishRules` (enum Finish). */
export const FINISH_RULE_KEYS = ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'];

/**
 * v1.29 (§4.28d) — valida un `PriceRuleSet` de DOS EJES `{ rarityRules, finishRules, fallbackPct? }`.
 * `ruleOk` valida UNA regla (buylist o venta). `rarityRules` = objeto por rareza; `finishRules` =
 * objeto por acabado (key ∈ enum Finish). Money-safe: rechaza formas/keys/valores inválidos → 422.
 */
export function validatePriceRuleSet(v: unknown, ruleOk: (r: unknown) => boolean, pctHint: string): string | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return 'must be an object { rarityRules, finishRules, fallbackPct? }';
  }
  const set = v as { rarityRules?: unknown; finishRules?: unknown };
  const rr = set.rarityRules;
  if (rr === undefined || rr === null || typeof rr !== 'object' || Array.isArray(rr)) {
    return 'rarityRules must be an object map { [canonicalRarity]: { mode, value } }';
  }
  for (const [rarity, rule] of Object.entries(rr as Record<string, unknown>)) {
    if (!ruleOk(rule)) return `invalid rarityRule for "${rarity}": ${pctHint}`;
  }
  const fr = set.finishRules;
  if (fr === undefined || fr === null || typeof fr !== 'object' || Array.isArray(fr)) {
    return 'finishRules must be an object map { [finish]: { mode, value } }';
  }
  for (const [finish, rule] of Object.entries(fr as Record<string, unknown>)) {
    if (!FINISH_RULE_KEYS.includes(finish)) {
      return `invalid finishRule key "${finish}": must be one of ${FINISH_RULE_KEYS.join('|')}`;
    }
    if (!ruleOk(rule)) return `invalid finishRule for "${finish}": ${pctHint}`;
  }
  return null;
}

/**
 * v1.37 (§4.33b) — valida un `TieredRuleSet` `{ tierRules, finishRules, fallbackPct? }`. `tierRules` =
 * objeto keyeado por `TierId` (T0–T4; toda key debe ser un `TierId` válido, cada regla válida);
 * `finishRules` = objeto por acabado (key ∈ enum Finish); `fallbackPct` opcional (vive en el dial separado).
 * NO exige las 5 entradas aquí (una tabla parcial cae al fallback); el PUT /pricing/tiers sí exige las 5.
 */
export function validateTieredRuleSet(v: unknown, ruleOk: (r: unknown) => boolean, pctHint: string): string | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return 'must be an object { tierRules, finishRules, fallbackPct? }';
  }
  const set = v as { tierRules?: unknown; finishRules?: unknown };
  const tr = set.tierRules;
  if (tr === undefined || tr === null || typeof tr !== 'object' || Array.isArray(tr)) {
    return 'tierRules must be an object map { [TierId]: { mode, value } }';
  }
  for (const [tierId, rule] of Object.entries(tr as Record<string, unknown>)) {
    if (!isTierId(tierId)) return `invalid tier "${tierId}": must be one of ${TIER_IDS.join('|')}`;
    if (!ruleOk(rule)) return `invalid tierRule for "${tierId}": ${pctHint}`;
  }
  const fr = set.finishRules;
  if (fr === undefined || fr === null || typeof fr !== 'object' || Array.isArray(fr)) {
    return 'finishRules must be an object map { [finish]: { mode, value } }';
  }
  for (const [finish, rule] of Object.entries(fr as Record<string, unknown>)) {
    if (!FINISH_RULE_KEYS.includes(finish)) {
      return `invalid finishRule key "${finish}": must be one of ${FINISH_RULE_KEYS.join('|')}`;
    }
    if (!ruleOk(rule)) return `invalid finishRule for "${finish}": ${pctHint}`;
  }
  return null;
}

/**
 * Valida la tabla `buylist_price_rules`. v1.37 (§4.33b): acepta el `TieredRuleSet` (`{ tierRules,
 * finishRules }`, forma NUEVA por tiers), el `PriceRuleSet` de DOS EJES (`{ rarityRules, finishRules }`,
 * compat pre-M-38) o el mapa PLANO legacy (`{ [rarity]: rule }`). Cada regla: fixed→entero
 * [0,FIXED_CENTS_MAX] cents · pct→número [0,100].
 */
export function validateBuylistRules(v: unknown): string | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return 'must be an object map, TieredRuleSet { tierRules, finishRules } or PriceRuleSet { rarityRules, finishRules }';
  }
  const hint = `fixed→integer in [0,${FIXED_CENTS_MAX}] (cents), pct→number in [0,100]`;
  if ('tierRules' in (v as object)) {
    return validateTieredRuleSet(v, isValidBuylistRule, hint);
  }
  if ('rarityRules' in (v as object) || 'finishRules' in (v as object)) {
    return validatePriceRuleSet(v, isValidBuylistRule, hint);
  }
  for (const [rarity, rule] of Object.entries(v as Record<string, unknown>)) {
    if (!isValidBuylistRule(rule)) return `invalid rule for rarity "${rarity}": ${hint}`;
  }
  return null;
}

/**
 * v1.37 (§4.33b) — valida el mapa `pricing_tier_map` (`Record<canonicalRarity, TierId>`): objeto (no
 * array), cada value un `TierId` válido. La existencia de la rareza en el catálogo canónico se valida en
 * el PUT /pricing/tier-map (422 UNKNOWN_RARITY); aquí solo forma+TierId (money-safe: no siembra tiers
 * inventados).
 */
export function validateTierMap(v: unknown): string | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return 'must be an object map { [canonicalRarity]: TierId }';
  }
  for (const [rarity, tierId] of Object.entries(v as Record<string, unknown>)) {
    if (!isTierId(tierId)) {
      return `invalid tier for rarity "${rarity}": must be one of ${TIER_IDS.join('|')}`;
    }
  }
  return null;
}

/** Valida el fallback `buylist_price_fallback_pct` (número en [0, 100]). */
export function validateFallbackPct(v: unknown): string | null {
  return isNum(v) && v >= 0 && v <= 100 ? null : 'must be a number in [0, 100]';
}

/**
 * v1.13-sales-pricing (§4.14a): tope del `pct` de VENTA. A diferencia del pct de buylist (que topa
 * en [0,100] porque comprar a >100% de mercado no tiene sentido), el pct de venta es un MARKUP
 * ARRIBA de mercado y SÍ puede superar 100% (una chase se lista a 2×–3× market). Tope 1000% evita
 * typos catastróficos sin limitar el markup real. Ver ARCHITECTURE decisión abierta v1.13-2.
 */
export const SALES_PCT_MAX = 1000;

/**
 * v1.13-sales-pricing (§4.14a): valida UNA regla de precio de VENTA `{ mode, value }`.
 * fixed → value entero ≥ 0 (piso MX$ centavos). pct → value número en [0, SALES_PCT_MAX] (markup %).
 * Clona `isValidBuylistRule` cambiando solo el tope del pct (100 → 1000).
 */
export function isValidSalesRule(v: unknown): boolean {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as { mode?: unknown; value?: unknown };
  // BE-27: fixed acotado arriba por FIXED_CENTS_MAX (evita overflow Int32 al persistir `*Cents`).
  if (r.mode === 'fixed') return isInt(r.value) && r.value >= 0 && r.value <= FIXED_CENTS_MAX;
  if (r.mode === 'pct') return isNum(r.value) && r.value >= 0 && r.value <= SALES_PCT_MAX;
  return false;
}

/**
 * Valida la tabla `sales_price_rules`. v1.29 (§4.28d): acepta el `PriceRuleSet` de DOS EJES
 * (forma NUEVA) o el mapa PLANO legacy. Cada regla: fixed→entero [0,FIXED_CENTS_MAX] cents ·
 * pct→número [0,SALES_PCT_MAX] (markup arriba de mercado).
 */
export function validateSalesRules(v: unknown): string | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return 'must be an object map, TieredRuleSet { tierRules, finishRules } or PriceRuleSet { rarityRules, finishRules }';
  }
  const hint = `fixed→integer in [0,${FIXED_CENTS_MAX}] (cents), pct→number in [0,${SALES_PCT_MAX}]`;
  if ('tierRules' in (v as object)) {
    return validateTieredRuleSet(v, isValidSalesRule, hint);
  }
  if ('rarityRules' in (v as object) || 'finishRules' in (v as object)) {
    return validatePriceRuleSet(v, isValidSalesRule, hint);
  }
  for (const [rarity, rule] of Object.entries(v as Record<string, unknown>)) {
    if (!isValidSalesRule(rule)) return `invalid rule for rarity "${rarity}": ${hint}`;
  }
  return null;
}

/** Valida el fallback `sales_price_fallback_pct` (número en [0, SALES_PCT_MAX]). */
export function validateSalesFallbackPct(v: unknown): string | null {
  return isNum(v) && v >= 0 && v <= SALES_PCT_MAX ? null : `must be a number in [0, ${SALES_PCT_MAX}]`;
}

/**
 * v1.23-sealed-sales (§4.23c): tope del spread de venta del sellado. Mismo criterio que el pct de
 * venta (markup arriba de mercado): puede superar 100% (una promo/pieza rara), tope 1000% evita typos.
 * SUP-8: el validador PERMITE `>= 0` (un spread 0 vende a mercado sin margen; el editor M2 lo advierte);
 * no se fuerza `> 0` para no bloquear una promo deliberada.
 */
export const SEALED_SPREAD_PCT_MAX = 1000;

/** Subtipos válidos del sellado (llaves de `sealed_spread_pct_by_subtype`). */
export const SEALED_SUBTYPE_KEYS = ['box', 'etb', 'bundle', 'tin', 'blister'];

/**
 * Valida el mapa `sealed_spread_pct_by_subtype`: objeto, cada clave ∈ SEALED_SUBTYPE_KEYS, cada
 * value número en [0, SEALED_SPREAD_PCT_MAX]. API_CONTRACT §M2 (GET/PUT /admin/pricing/sealed-spreads).
 */
export function validateSealedSpreads(v: unknown): string | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return 'must be an object map { [subtype]: number }';
  }
  for (const [subtype, value] of Object.entries(v as Record<string, unknown>)) {
    if (!SEALED_SUBTYPE_KEYS.includes(subtype)) {
      return `invalid subtype "${subtype}": must be one of ${SEALED_SUBTYPE_KEYS.join('|')}`;
    }
    if (!(isNum(value) && value >= 0 && value <= SEALED_SPREAD_PCT_MAX)) {
      return `invalid spread for "${subtype}": must be a number in [0, ${SEALED_SPREAD_PCT_MAX}]`;
    }
  }
  return null;
}

/** Valida el fallback `sealed_spread_fallback_pct` (número en [0, SEALED_SPREAD_PCT_MAX]). */
export function validateSealedSpreadFallback(v: unknown): string | null {
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
 * v1.44-graded-estimate (I7, §4.35d) — valida una LISTA de grados (`grades` / `highlightGrades`):
 * array de strings ⊆ `{"10","9"}`, NO vacío y sin duplicados. Lista cerrada a propósito: otros grados
 * (PSA <= 8) y otras graduadoras quedan fuera de alcance (§N.1), y una key desconocida sembraría un
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
  [SettingKey.BUYLIST_PRICE_RULES]: validateBuylistRules,
  [SettingKey.BUYLIST_PRICE_FALLBACK_PCT]: validateFallbackPct,
  // v1.13-sales-pricing (§4.14a): reglas de VENTA por rareza + fallback (pct = markup arriba de mercado).
  [SettingKey.SALES_PRICE_RULES]: validateSalesRules,
  [SettingKey.SALES_PRICE_FALLBACK_PCT]: validateSalesFallbackPct,
  // v1.37 (§4.33b): mapa compartido rareza→tier. Se valida forma+TierId; la existencia de la rareza en
  // el catálogo la valida el PUT /pricing/tier-map (422 UNKNOWN_RARITY). No editable por PUT /settings.
  [SettingKey.PRICING_TIER_MAP]: validateTierMap,
  // v1.23-sealed-sales (§4.23c/§4.23h): spreads del sellado (editados por M2, no por PUT settings,
  // pero se validan igual) + feature flags on|off.
  [SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE]: validateSealedSpreads,
  [SettingKey.SEALED_SPREAD_FALLBACK_PCT]: validateSealedSpreadFallback,
  [SettingKey.SEALED_VALUE_TREND]: (v) =>
    typeof v === 'string' && FEATURE_FLAG_VALUES.includes(v) ? null : `must be one of ${FEATURE_FLAG_VALUES.join('|')}`,
  [SettingKey.SEALED_RESTOCK_ALERTS]: (v) =>
    typeof v === 'string' && FEATURE_FLAG_VALUES.includes(v) ? null : `must be one of ${FEATURE_FLAG_VALUES.join('|')}`,
  // v1.44-graded-estimate (M-41, §4.35d): los cinco diales de M2 se editan por
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
  // v1.1: frontera por defecto del sync de catálogo M2 (API_CONTRACT §M10).
  // ConfigSetting de primera clase: legible por GET y editable por PUT (validador yyyy/MM/dd).
  catalogSyncFromDate: SettingKey.CATALOG_SYNC_FROM_DATE,
};
