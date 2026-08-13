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

/** Cotización del buylist. AcquisitionPricer. ARCHITECTURE §4.2. */
export type BuylistCategory = 'comun' | 'reverse_holo' | 'ex_plus';

export interface AcquisitionQuote {
  quotedPriceCents: number | null;
  status: 'cotizada' | 'precio_pendiente';
}

/**
 * AcquisitionPricer (función pura). ARCHITECTURE §4.2.
 * común = MX$0.50 (50c), reverse_holo = MX$1.50 (150c), ex_plus = round(referencia × 0.40).
 * EX+ sin referencia → precio_pendiente (nunca se descarta; escala al dueño).
 */
export function quoteAcquisition(
  category: BuylistCategory,
  referenceMxnCents: number | null,
): AcquisitionQuote {
  switch (category) {
    case 'comun':
      return { quotedPriceCents: 50, status: 'cotizada' };
    case 'reverse_holo':
      return { quotedPriceCents: 150, status: 'cotizada' };
    case 'ex_plus':
      return referenceMxnCents == null
        ? { quotedPriceCents: null, status: 'precio_pendiente' }
        : { quotedPriceCents: Math.round(referenceMxnCents * 0.4), status: 'cotizada' };
    default: {
      const _exhaustive: never = category;
      throw new Error(`Unknown buylist category: ${_exhaustive as string}`);
    }
  }
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
 *   total    = ceil((base + fija) / (1 − pct))             (gross-up de comisión Stripe)
 *   fee      = total − base                                (línea visible, SIN IVA adicional)
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
 * Gross-up del total para que, tras la comisión Stripe (pct + fija), la
 * plataforma reciba íntegro `baseCents`. total = ceil((base + fija) / (1 − pct)).
 */
export function grossUpTotal(baseCents: number, fee: StripeFeeConfig): number {
  if (fee.stripePct < 0 || fee.stripePct >= 1) {
    throw new Error('stripePct must be in [0, 1)');
  }
  return Math.ceil((baseCents + fee.stripeFixedCents) / (1 - fee.stripePct));
}

/** Precio MXN desde USD con FX + colchón. ARCHITECTURE §3.2 FxRate. */
export function usdToMxnCents(priceUsdCents: number, rate: number, bufferPct: number): number {
  return Math.round(priceUsdCents * rate * (1 + bufferPct / 100));
}
