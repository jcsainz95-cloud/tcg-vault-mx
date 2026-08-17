/**
 * money.ts — Funciones puras de dinero (centavos MXN). Sin dependencias de infra.
 * Fuente de verdad: ARCHITECTURE.md §5.1 (checkout, IVA, fee gross-up) y §10.1 (markup).
 *
 * Toda cantidad es un entero de centavos MXN. No se usan floats para persistir dinero.
 */

export interface StripeFeeConfig {
  /** Tarifa porcentual de Stripe como fracción (ej. 0.036 = 3.6%). */
  stripePct: number;
  /** Tarifa fija de Stripe en centavos (ej. 300 = MX$3.00). */
  stripeFixedCents: number;
  /**
   * C1: IVA (fracción) que Stripe MX cobra SOBRE su comisión (ej. 0.16 = 16%).
   * En México Stripe factura su comisión con IVA, así que la deducción real es
   * `(1 + stripeFeeIvaPct) × (pct × total + fija)`. El gross-up debe cubrirlo para
   * que la plataforma netee íntegro `base`. Dial `stripe_fee_iva_pct` (default 0.16).
   */
  stripeFeeIvaPct: number;
}

/**
 * Precio de venta = round(referencia × (1 + markup%)). ARCHITECTURE §10.1.
 * El "valor de mercado" mostrado sigue siendo la referencia; esto es el precio cobrado.
 */
export function computeSalePriceCents(referenceMxnCents: number, salesMarkupPct: number): number {
  return Math.round(referenceMxnCents * (1 + salesMarkupPct / 100));
}

/**
 * Costo de aportación en especie = round(referencia × pct/100). PROJECT criterio 28.
 */
export function computeAportacionCostCents(referenceMxnCents: number, aportacionPct: number): number {
  return Math.round(referenceMxnCents * (aportacionPct / 100));
}

/**
 * AcquisitionPricer (buylist) — tabla de precio por RAREZA OFICIAL. ARCHITECTURE §4.2 (v1.3.1).
 * Reemplaza el esquema de 3 categorías (BuylistCategory). El monto se resuelve con la regla
 * por rareza real de la carta (`Card.rarity`), editable en M2.
 */
export type BuylistRuleMode = 'fixed' | 'pct';
/** value = centavos MXN si mode='fixed'; porcentaje [0,100] de la referencia si mode='pct'. */
export interface BuylistRule {
  mode: BuylistRuleMode;
  value: number;
}

export interface AcquisitionQuote {
  quotedPriceCents: number | null;
  status: 'cotizada' | 'precio_pendiente';
  /** Regla efectivamente aplicada (explícita o fallback). */
  appliedRule: BuylistRule;
  /** "rule" = fila explícita en BUYLIST_PRICE_RULES; "fallback" = BUYLIST_PRICE_FALLBACK_PCT. */
  ruleSource: 'rule' | 'fallback';
}

/**
 * AcquisitionPricer (función pura, v1.3.1). ARCHITECTURE §4.2.
 * - Busca la regla por la RAREZA OFICIAL real (exact match sobre `Card.rarity`). Sin regla → fallback %.
 * - fixed → monto fijo en centavos; NO depende de la referencia → siempre 'cotizada'.
 * - pct   → round(referencia × value/100). Si falta referencia → 'precio_pendiente' (escala al dueño).
 *
 * SEC-A1: la `rarity` se deriva server-side de la carta real, nunca del DTO del cliente.
 */
export function quoteAcquisition(
  rarity: string | null,
  referenceMxnCents: number | null,
  rules: Record<string, BuylistRule>,
  fallbackPct: number,
): AcquisitionQuote {
  const explicit = rarity != null ? rules[rarity] : undefined;
  const rule: BuylistRule = explicit ?? { mode: 'pct', value: fallbackPct };
  const ruleSource: 'rule' | 'fallback' = explicit ? 'rule' : 'fallback';

  if (rule.mode === 'fixed') {
    return { quotedPriceCents: rule.value, status: 'cotizada', appliedRule: rule, ruleSource };
  }
  // pct
  if (referenceMxnCents == null) {
    return { quotedPriceCents: null, status: 'precio_pendiente', appliedRule: rule, ruleSource };
  }
  return {
    quotedPriceCents: Math.round((referenceMxnCents * rule.value) / 100),
    status: 'cotizada',
    appliedRule: rule,
    ruleSource,
  };
}

/**
 * v1.6-finish — resolver finish→regla determinista (ARCHITECTURE §4.2.1).
 * El acabado seleccionado determina (a) qué regla de BUYLIST_PRICE_RULES aplica y (b) qué
 * referencia de mercado usa el `pct` (la del ACABADO cotizado). NO se mete en gradeKey: es
 * ortogonal. El monto se deriva SIEMPRE server-side de (Card.rarity, finish) validado (SEC-A1).
 */
export type Finish = 'normal' | 'reverse_holo' | 'holofoil' | 'first_edition_holofoil';

/**
 * Una rareza "ya es holo" si su string (pokemontcg.io) contiene "holo" (case-insensitive):
 * "Rare Holo", "Rare Holo EX/GX/V/VMAX/VSTAR"… (NO "Ultra Rare"/"Illustration Rare").
 */
export function isHoloRarity(rarity: string | null): boolean {
  return rarity != null && rarity.toLowerCase().includes('holo');
}

/**
 * Fase 0.1 — Clasificador de rareza PREMIUM (chase / alto valor).
 *
 * Regla de negocio del humano: SOLO Common/Uncommon y el "holo/reverse común" son precio FIJO de
 * bulk; todo lo más raro es un % arriba de MERCADO. Una rareza premium por tanto NUNCA debe poder
 * caer al bin fijo barato de bulk (la clave sintética "Holo" ni ninguna regla `fixed` de bulk):
 * debe resolver por su PROPIA regla explícita o, en su defecto, al fallback pct (% de mercado).
 *
 * Matching robusto por substrings/tokens representativos, case-insensitive (la taxonomía de
 * pokemontcg.io es abierta). Cubre: Illustration Rare, Special Illustration Rare, Ultra Rare,
 * Double Rare (= ex), Rare Secret/Rainbow/Hyper/Gold, Full Art, Alternate Art, Amazing Rare,
 * Radiant, Shiny, Trainer Gallery, Character/Super Rare, Prism Star, y las Rare Holo
 * V/VMAX/VSTAR/EX/GX. Se prefiere sobre-incluir (una carta barata clasificada premium solo pasa a
 * "% de mercado", inocuo) que sub-incluir (una chase tratada como bulk = pérdida de dinero).
 *
 * NO premium (excluidas a propósito): Common, Uncommon, Rare (no-holo), Rare Holo (plano),
 * Reverse Holo — el bulk legítimo.
 */
const PREMIUM_RARITY_PATTERNS: RegExp[] = [
  /illustration/, // Illustration Rare, Special Illustration Rare
  /ultra\s*rare/, // Ultra Rare (full art)
  /double\s*rare/, // Double Rare (ex, era Scarlet & Violet)
  /secret/, // Rare Secret, Secret Rare
  /rainbow/, // Rainbow Rare
  /hyper/, // Hyper Rare
  /full\s*art/, // Full Art
  /alt(ernate)?\s*art/, // Alternate Art / Alt Art
  /special/, // Special Illustration Rare, etc.
  /amazing/, // Amazing Rare
  /radiant/, // Radiant
  /shiny/, // Rare Shiny / Shiny Ultra Rare
  /trainer\s*gallery/, // Trainer Gallery
  /character/, // Character Rare / Super Rare
  /gold/, // Gold (secret) Rare
  /prism/, // Prism Star
  /\b(v|vmax|vstar|vunion|v-union|ex|gx)\b/, // V-series y EX/GX como tokens sueltos (p. ej. "Rare Holo VMAX")
];

/**
 * Fase 0.1 — true si la rareza es "chase"/alto valor y por tanto debe cotizar por su propia regla
 * explícita o por el fallback pct (% de mercado), NUNCA por el bin fijo barato de bulk.
 */
export function isPremiumRarity(rarity: string | null): boolean {
  if (rarity == null) return false;
  const s = rarity.toLowerCase();
  return PREMIUM_RARITY_PATTERNS.some((re) => re.test(s));
}

/**
 * Candidatos de ruleKey EN ORDEN DE PRIORIDAD (gana el primero con regla explícita en
 * BUYLIST_PRICE_RULES; si ninguno → BUYLIST_PRICE_FALLBACK_PCT).
 *
 * Fase 0.1 (fix bug de dinero): la RAREZA REAL SIEMPRE va primero en los candidatos. Además, para
 * finish holofoil/1st-ed una rareza PREMIUM (chase) NO puede incluir la clave sintética "Holo"
 * (que el admin puede tener fija barata de bulk): solo su propia regla o el fallback pct. Antes,
 * una holo premium sin "holo" en el string (Illustration/Ultra/Double Rare, etc.) resolvía a
 * `['Holo']` y una chase de miles de pesos cotizaba al bin fijo barato — bug estructural.
 *
 *  - reverse_holo            → ["Reverse Holo"]
 *  - holofoil / 1st ed holo  → premium              ? [rarity]           (propia regla o fallback pct; NUNCA "Holo")
 *                              : isHoloRarity(rarity)? [rarity, "Holo"]  (holo de bulk: rareza real primero, luego "Holo")
 *                              :                        ["Holo"]          (Common/Uncommon: % del market holofoil, §4.2.1)
 *  - normal                  → [rarity] (regla de la rareza base)
 */
export function ruleKeyCandidates(rarity: string | null, finish: Finish): string[] {
  switch (finish) {
    case 'reverse_holo':
      return ['Reverse Holo'];
    case 'holofoil':
    case 'first_edition_holofoil':
      // Fase 0.1 (fix bug de dinero): una rareza PREMIUM (chase) NUNCA incluye "Holo" ni ningún bin
      // fijo de bulk. Solo su propia regla explícita o el fallback pct (% de mercado). La rareza real
      // va SIEMPRE primero. Cierra la vía por la que Illustration/Ultra/Double Rare, etc. (holo sin
      // "holo" en el string) cotizaban al bin fijo barato `['Holo']`.
      if (isPremiumRarity(rarity)) {
        return [rarity as string];
      }
      // NO premium: se preserva la semántica documentada en ARCHITECTURE §4.2.1 (guarda isHoloRarity):
      //  - holo de bulk (p. ej. "Rare Holo") → [rarity, "Holo"] (rareza real primero, luego "Holo").
      //  - Common/Uncommon (no-holo) → ["Holo"] → market holofoil (% ), NO su regla fija $0.50 de bulk
      //    (una copia holofoil de una común vale un % de su market holofoil, no $0.50). Ver §4.2.1.
      return isHoloRarity(rarity) ? [rarity as string, 'Holo'] : ['Holo'];
    case 'normal':
      return rarity != null ? [rarity] : [];
    default:
      return [];
  }
}

/** Aplica una regla ya resuelta (misma lógica que quoteAcquisition §4.2). */
function applyRule(
  rule: BuylistRule,
  ruleSource: 'rule' | 'fallback',
  referenceMxnCents: number | null,
): AcquisitionQuote {
  if (rule.mode === 'fixed') {
    return { quotedPriceCents: rule.value, status: 'cotizada', appliedRule: rule, ruleSource };
  }
  if (referenceMxnCents == null) {
    return { quotedPriceCents: null, status: 'precio_pendiente', appliedRule: rule, ruleSource };
  }
  return {
    quotedPriceCents: Math.round((referenceMxnCents * rule.value) / 100),
    status: 'cotizada',
    appliedRule: rule,
    ruleSource,
  };
}

/**
 * AcquisitionPricer POR ACABADO (v1.6-finish, función pura). ARCHITECTURE §4.2.1.
 * `referenceMxnCentsForFinish` = PriceReference.priceMxnCents del ACABADO cotizado
 * (`getReference(..., finish)`). Para `first_edition_holofoil`, esa referencia es la de la
 * llave `1stEditionHolofoil`. SEC-A1: rarity/finish derivados server-side y finish validado
 * contra card.availableFinishes por el caller ANTES de cotizar.
 */
export function quoteAcquisitionForFinish(
  rarity: string | null,
  finish: Finish,
  referenceMxnCentsForFinish: number | null,
  rules: Record<string, BuylistRule>,
  fallbackPct: number,
): AcquisitionQuote {
  const candidates = ruleKeyCandidates(rarity, finish);
  const hitKey = candidates.find((k) => rules[k] != null);
  const rule: BuylistRule = hitKey ? rules[hitKey] : { mode: 'pct', value: fallbackPct };
  const ruleSource: 'rule' | 'fallback' = hitKey ? 'rule' : 'fallback';
  return applyRule(rule, ruleSource, referenceMxnCentsForFinish);
}

export interface BreakdownDTO {
  subtotalCents: number;
  ivaCents: number;
  ivaRatePct: number;
  processingFeeCents: number;
  totalCents: number;
  currency: 'MXN';
}

/**
 * Desglose de compra de cartas. ARCHITECTURE §5.1.
 *   subtotal = Σ salePrice
 *   iva      = round(subtotal × ivaPct/100)                (IVA grava el subtotal)
 *   base     = subtotal + iva                              (lo que la plataforma recibe íntegro)
 *   total    = ceil((base + (1+ivaFee)·fija) / (1 − (1+ivaFee)·pct))   (gross-up con IVA de Stripe)
 *   fee      = total − base                                (línea visible; incluye el IVA de la comisión Stripe)
 */
export function computeCartBreakdown(
  subtotalCents: number,
  ivaPct: number,
  fee: StripeFeeConfig,
): BreakdownDTO {
  const ivaCents = Math.round((subtotalCents * ivaPct) / 100);
  const baseCents = subtotalCents + ivaCents;
  const totalCents = grossUpTotal(baseCents, fee);
  const processingFeeCents = totalCents - baseCents;
  return {
    subtotalCents,
    ivaCents,
    ivaRatePct: ivaPct,
    processingFeeCents,
    totalCents,
    currency: 'MXN',
  };
}

/**
 * Desglose de retiro/envío. ARCHITECTURE §5.1.
 * El IVA grava la tarifa de envío; el fee es gross-up (sin IVA).
 * En el DTO, subtotalCents = tarifa de envío (ver API_CONTRACT §5).
 */
export function computeShipmentBreakdown(
  shippingFeeCents: number,
  ivaPct: number,
  fee: StripeFeeConfig,
): BreakdownDTO {
  const ivaCents = Math.round((shippingFeeCents * ivaPct) / 100);
  const baseCents = shippingFeeCents + ivaCents;
  const totalCents = grossUpTotal(baseCents, fee);
  const processingFeeCents = totalCents - baseCents;
  return {
    subtotalCents: shippingFeeCents,
    ivaCents,
    ivaRatePct: ivaPct,
    processingFeeCents,
    totalCents,
    currency: 'MXN',
  };
}

/**
 * Gross-up del total para que, tras la comisión Stripe (pct + fija) MÁS el IVA que
 * Stripe MX cobra sobre esa comisión, la plataforma reciba íntegro `baseCents`.
 *
 * C1: la deducción real de Stripe es `(1 + ivaFee) × (pct × total + fija)`. Resolviendo
 * `total − (1+ivaFee)(pct·total + fija) = base`:
 *   total = ceil((base + (1+ivaFee)·fija) / (1 − (1+ivaFee)·pct)).
 */
export function grossUpTotal(baseCents: number, fee: StripeFeeConfig): number {
  const ivaMul = 1 + fee.stripeFeeIvaPct;
  if (fee.stripeFeeIvaPct < 0 || !Number.isFinite(fee.stripeFeeIvaPct)) {
    throw new Error('stripeFeeIvaPct must be a finite number >= 0');
  }
  const effectivePct = fee.stripePct * ivaMul;
  if (effectivePct < 0 || effectivePct >= 1) {
    throw new Error('effective stripe pct (stripePct × (1 + stripeFeeIvaPct)) must be in [0, 1)');
  }
  const effectiveFixed = fee.stripeFixedCents * ivaMul;
  return Math.ceil((baseCents + effectiveFixed) / (1 - effectivePct));
}

/** Precio MXN desde USD con FX + colchón. ARCHITECTURE §3.2 FxRate. */
export function usdToMxnCents(priceUsdCents: number, rate: number, bufferPct: number): number {
  return Math.round(priceUsdCents * rate * (1 + bufferPct / 100));
}
