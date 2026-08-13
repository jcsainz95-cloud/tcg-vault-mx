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
  BUYLIST_CAP_PER_REQUEST_CENTS: 'buylist_cap_per_request_cents',
  BUYLIST_CAP_PER_MONTH_CENTS: 'buylist_cap_per_month_cents',
  INE_THRESHOLD_CENTS: 'ine_threshold_cents',
  REPO_CAP_PER_CARD_CENTS: 'repo_cap_per_card_cents',
  FX_BUFFER_PCT: 'fx_buffer_pct',
  FX_MANUAL_OVERRIDE_RATE: 'fx_manual_override_rate',
  PRICING_PROVIDER_RAW: 'pricing_provider_raw',
  PRICING_PROVIDER_GRADED: 'pricing_provider_graded',
  PRICING_PROVIDER_SEALED: 'pricing_provider_sealed',
  RARITY_MAP: 'rarity_map',
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
  [SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS]: 300000, // MX$3,000
  [SettingKey.BUYLIST_CAP_PER_MONTH_CENTS]: 1000000, // MX$10,000
  [SettingKey.INE_THRESHOLD_CENTS]: 300000, // = tope por solicitud
  [SettingKey.REPO_CAP_PER_CARD_CENTS]: 5000000, // tope de reposición por carta (editable)
  [SettingKey.FX_BUFFER_PCT]: 3, // colchón FX (%)
  [SettingKey.FX_MANUAL_OVERRIDE_RATE]: null, // sin override por defecto
  [SettingKey.PRICING_PROVIDER_RAW]: 'pokemontcg_io',
  [SettingKey.PRICING_PROVIDER_GRADED]: 'pokemonpricetracker',
  [SettingKey.PRICING_PROVIDER_SEALED]: 'pokemonpricetracker',
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

/** Mapea las keys de DB a los nombres camelCase del DTO de M10 (API_CONTRACT §M10). */
export const SETTING_DTO_MAP: Record<string, SettingKeyType> = {
  shippingFeeCents: SettingKey.SHIPPING_FEE_CENTS,
  aportacionPct: SettingKey.APORTACION_PCT,
  ivaPct: SettingKey.IVA_PCT,
  salesMarkupPct: SettingKey.SALES_MARKUP_PCT,
  stripeFeePct: SettingKey.STRIPE_FEE_PCT,
  stripeFeeFixedCents: SettingKey.STRIPE_FEE_FIXED_CENTS,
  buylistCapPerRequestCents: SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS,
  buylistCapPerMonthCents: SettingKey.BUYLIST_CAP_PER_MONTH_CENTS,
  ineThresholdCents: SettingKey.INE_THRESHOLD_CENTS,
  repoCapPerCardCents: SettingKey.REPO_CAP_PER_CARD_CENTS,
  fxBufferPct: SettingKey.FX_BUFFER_PCT,
  fxManualOverrideRate: SettingKey.FX_MANUAL_OVERRIDE_RATE,
  pricingProviderRaw: SettingKey.PRICING_PROVIDER_RAW,
  pricingProviderGraded: SettingKey.PRICING_PROVIDER_GRADED,
  pricingProviderSealed: SettingKey.PRICING_PROVIDER_SEALED,
};
