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
