/**
 * settings.constants.ts — Diales M10 (ConfigSetting). ARCHITECTURE §3.2, §5.1.
 * Los valores viven en DB (editables sin redeploy). Aquí solo las KEYS y los DEFAULTS.
 */
export const SettingKey = {
  SHIPPING_FEE_CENTS: 'shipping_fee_cents',
  APORTACION_PCT: 'aportacion_pct',
  IVA_PCT: 'iva_pct',
  SALES_MARKUP_PCT: 'sales_markup_pct',
  STRIPE_FEE_PCT: 'stripe_fee_pct',
  STRIPE_FEE_FIXED_CENTS: 'stripe_fee_fixed_cents',
  // C1/D4: IVA (fracción) que Stripe MX cobra SOBRE su comisión. El gross-up lo incluye
  // para que la plataforma netee íntegro subtotal+IVA. v1.1: el contrato §M10 lo lista en
  // el DTO de settings, así que se expone en SETTING_DTO_MAP (`stripeFeeIvaPct`).
  STRIPE_FEE_IVA_PCT: 'stripe_fee_iva_pct',
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
  // DEPRECADO v1.3.1: `rarity_map` (RARITY_MAP) ya NO lo lee la cotización (reemplazado por
  // BUYLIST_PRICE_RULES). Se conserva como no-op/legacy hasta su retiro; no se siembra en nuevos.
  RARITY_MAP: 'rarity_map',
  // Retención de INE (días desde el cierre/pago de la solicitud) antes de purgar imágenes.
  // Dial interno (LFPDPPP): NO se expone en el DTO de M10 hasta que el arquitecto lo
  // formalice en el contrato (ver docs/BACKEND_NOTES.md).
  INE_RETENTION_DAYS: 'ine_retention_days',
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
  [SettingKey.STRIPE_FEE_IVA_PCT]: 0.16, // C1: IVA 16% sobre la comisión de Stripe MX (fracción)
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
  [SettingKey.INE_RETENTION_DAYS]: 180, // 6 meses por defecto (ajustable por el negocio/legal)
  [SettingKey.CATALOG_SYNC_FROM_DATE]: '2024/01/01', // v1.1: sets de 2024 en adelante
  // v1.3.1 (§E.1): seed que PRESERVA el negocio vigente (Common/Uncommon $0.50 fijo, Reverse
  // Holo $1.50 fijo, todo lo demás → fallback 40% de la referencia). value = centavos si fixed.
  [SettingKey.BUYLIST_PRICE_RULES]: {
    Common: { mode: 'fixed', value: 50 },
    Uncommon: { mode: 'fixed', value: 50 },
    'Reverse Holo': { mode: 'fixed', value: 150 },
  },
  [SettingKey.BUYLIST_PRICE_FALLBACK_PCT]: 40,
  // v1.13-sales-pricing (§4.14a): seed que reproduce el ejemplo del humano (Common $5, Uncommon $10,
  // holo/reverse $10 FIJOS; todo lo más raro cae al fallback = market × (1 + 15/100)). value = centavos
  // si fixed. Las claves "Holo"/"Reverse Holo" son sintéticas del resolver por acabado (§4.2.1/§4.14b).
  [SettingKey.SALES_PRICE_RULES]: {
    Common: { mode: 'fixed', value: 500 },
    Uncommon: { mode: 'fixed', value: 1000 },
    Holo: { mode: 'fixed', value: 1000 },
    'Reverse Holo': { mode: 'fixed', value: 1000 },
  },
  // Default 15 = iguala EXACTAMENTE el SALES_MARKUP_PCT vigente → preserva el precio de venta actual
  // (market × 1.15) para toda rareza que caiga al fallback. Solo el piso de bulk cambia.
  [SettingKey.SALES_PRICE_FALLBACK_PCT]: 15,
  [SettingKey.RARITY_MAP]: {
    Common: 'comun',
    Uncommon: 'comun',
    'Rare': 'comun',
    'Reverse Holo': 'reverse_holo',
    'Rare Holo': 'ex_plus',
    'Rare Holo EX': 'ex_plus',
    'Rare Holo GX': 'ex_plus',
    'Rare Holo V': 'ex_plus',
    'Rare Holo VMAX': 'ex_plus',
    'Rare Ultra': 'ex_plus',
    'Rare Secret': 'ex_plus',
  },
};

const PROVIDER_VALUES = ['pokemontcg_io', 'pokemonpricetracker', 'poketrace', 'manual'];

/**
 * v1.14-price-ingest (WS-A, §4.15h): valores válidos del dial `price_provider` (BulkPriceProvider).
 * SOLO los dos proveedores de ingest masivo (NO poketrace/manual, que son del pricing per-carta).
 */
export const PRICE_PROVIDER_VALUES = ['pokemontcg_io', 'pokemonpricetracker'];

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v);
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * v1.3.1 (§E.1): valida UNA regla de precio de buylist `{ mode, value }`.
 * fixed → value entero ≥ 0 (centavos MXN). pct → value número en [0, 100].
 */
export function isValidBuylistRule(v: unknown): boolean {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as { mode?: unknown; value?: unknown };
  if (r.mode === 'fixed') return isInt(r.value) && r.value >= 0;
  if (r.mode === 'pct') return isNum(r.value) && r.value >= 0 && r.value <= 100;
  return false;
}

/** Valida el mapa completo `buylist_price_rules` (objeto, cada entrada una regla válida). */
export function validateBuylistRules(v: unknown): string | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return 'must be an object map { [rarity]: { mode, value } }';
  }
  for (const [rarity, rule] of Object.entries(v as Record<string, unknown>)) {
    if (!isValidBuylistRule(rule)) {
      return `invalid rule for rarity "${rarity}": fixed→integer>=0 (cents), pct→number in [0,100]`;
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
  if (r.mode === 'fixed') return isInt(r.value) && r.value >= 0;
  if (r.mode === 'pct') return isNum(r.value) && r.value >= 0 && r.value <= SALES_PCT_MAX;
  return false;
}

/** Valida el mapa completo `sales_price_rules` (objeto, cada entrada una regla de venta válida). */
export function validateSalesRules(v: unknown): string | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return 'must be an object map { [rarity]: { mode, value } }';
  }
  for (const [rarity, rule] of Object.entries(v as Record<string, unknown>)) {
    if (!isValidSalesRule(rule)) {
      return `invalid rule for rarity "${rarity}": fixed→integer>=0 (cents), pct→number in [0,${SALES_PCT_MAX}]`;
    }
  }
  return null;
}

/** Valida el fallback `sales_price_fallback_pct` (número en [0, SALES_PCT_MAX]). */
export function validateSalesFallbackPct(v: unknown): string | null {
  return isNum(v) && v >= 0 && v <= SALES_PCT_MAX ? null : `must be a number in [0, ${SALES_PCT_MAX}]`;
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
  // IVA de la comisión Stripe: fracción en [0,1) (0.16 = 16%).
  [SettingKey.STRIPE_FEE_IVA_PCT]: (v) => (isNum(v) && v >= 0 && v < 1 ? null : 'must be a fraction in [0, 1)'),
  [SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)'),
  [SettingKey.BUYLIST_CAP_PER_MONTH_CENTS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)'),
  [SettingKey.INE_THRESHOLD_CENTS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)'),
  [SettingKey.REPO_CAP_PER_CARD_CENTS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)'),
  [SettingKey.FX_BUFFER_PCT]: (v) => (isNum(v) && v >= 0 && v <= 100 ? null : 'must be a number in [0, 100]'),
  // override de FX: null (sin override) o un tipo de cambio positivo.
  [SettingKey.FX_MANUAL_OVERRIDE_RATE]: (v) =>
    v === null || (isNum(v) && v > 0) ? null : 'must be null or a number > 0',
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
  [SettingKey.RARITY_MAP]: (v) =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? null : 'must be an object map',
  [SettingKey.BUYLIST_PRICE_RULES]: validateBuylistRules,
  [SettingKey.BUYLIST_PRICE_FALLBACK_PCT]: validateFallbackPct,
  // v1.13-sales-pricing (§4.14a): reglas de VENTA por rareza + fallback (pct = markup arriba de mercado).
  [SettingKey.SALES_PRICE_RULES]: validateSalesRules,
  [SettingKey.SALES_PRICE_FALLBACK_PCT]: validateSalesFallbackPct,
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
  // D4 (v1.1): el contrato §M10 ya lista `stripeFeeIvaPct` en el DTO de settings; se expone
  // aquí como los demás diales (validador de rango: fracción [0,1)).
  stripeFeeIvaPct: SettingKey.STRIPE_FEE_IVA_PCT,
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
  // v1.1: frontera por defecto del sync de catálogo M2 (API_CONTRACT §M10).
  // ConfigSetting de primera clase: legible por GET y editable por PUT (validador yyyy/MM/dd).
  catalogSyncFromDate: SettingKey.CATALOG_SYNC_FROM_DATE,
};
