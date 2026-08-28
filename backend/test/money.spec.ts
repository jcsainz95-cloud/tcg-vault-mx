import {
  computeCartBreakdown,
  computeShipmentBreakdown,
  grossUpTotal,
  computeSalePriceCents,
  computeAportacionCostCents,
  usdToMxnCents,
} from '../src/common/money';

describe('money — checkout formulas (ARCHITECTURE §5.1, C1: IVA sobre comisión Stripe)', () => {
  // C1: la comisión de Stripe MX lleva IVA 16% encima (stripeFeeIvaPct = 0.16).
  const fee = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };

  /**
   * Deducción REAL de Stripe MX = (1 + ivaFee) × (pct × total + fija). El gross-up debe
   * dejar que la plataforma netee exactamente `base` (dentro de <1 centavo por el ceil).
   */
  function stripeDeduction(total: number) {
    return (1 + fee.stripeFeeIvaPct) * (fee.stripePct * total + fee.stripeFixedCents);
  }

  describe('grossUpTotal (C1: incluye IVA de la comisión)', () => {
    it('nets exactly base after the real Stripe deduction WITH IVA', () => {
      const base = 100000; // MX$1000
      const total = grossUpTotal(base, fee);
      // total = ceil((100000 + 1.16*300) / (1 - 1.16*0.036)) = ceil(100348/0.95824) = 104722
      expect(total).toBe(104722);
      // Netea exactamente base: net ∈ [base, base+1) en aritmética continua.
      const net = total - stripeDeduction(total);
      expect(net).toBeGreaterThanOrEqual(base);
      expect(net).toBeLessThan(base + 1);
    });

    it('the added IVA on the fee raises the total vs. the no-IVA formula', () => {
      const base = 100000;
      const withIva = grossUpTotal(base, fee);
      const withoutIva = grossUpTotal(base, { ...fee, stripeFeeIvaPct: 0 });
      expect(withIva).toBeGreaterThan(withoutIva); // 104722 > 104046
      expect(withoutIva).toBe(104046);
    });

    it('throws when the effective pct (pct × (1+iva)) reaches 1', () => {
      expect(() =>
        grossUpTotal(1000, { stripePct: 0.9, stripeFixedCents: 0, stripeFeeIvaPct: 0.2 }),
      ).toThrow(); // 0.9 * 1.2 = 1.08 >= 1
    });

    it('throws for negative stripeFeeIvaPct', () => {
      expect(() =>
        grossUpTotal(1000, { stripePct: 0.036, stripeFixedCents: 0, stripeFeeIvaPct: -0.1 }),
      ).toThrow();
    });
  });

  describe('computeCartBreakdown', () => {
    it('applies 16% IVA on subtotal and gross-up fee INCLUDING Stripe fee IVA', () => {
      const b = computeCartBreakdown(100000, 16, fee);
      expect(b.subtotalCents).toBe(100000);
      expect(b.ivaCents).toBe(16000); // 16% de 100000
      expect(b.ivaRatePct).toBe(16);
      // base = 116000; total = ceil((116000 + 1.16*300)/0.95824) = ceil(121418.9) = 121419
      expect(b.totalCents).toBe(121419);
      expect(b.processingFeeCents).toBe(b.totalCents - 116000); // 5419
      // total = subtotal + iva + fee
      expect(b.totalCents).toBe(b.subtotalCents + b.ivaCents + b.processingFeeCents);
      expect(b.currency).toBe('MXN');
      // Netea exactamente base = subtotal + iva.
      const net = b.totalCents - stripeDeduction(b.totalCents);
      expect(net).toBeGreaterThanOrEqual(116000);
      expect(net).toBeLessThan(116000 + 1);
    });

    it('the product IVA (16% on subtotal) is NOT applied to the fee line itself', () => {
      const b = computeCartBreakdown(50000, 16, fee);
      // El IVA del DESGLOSE grava el subtotal, no el fee. El fee cubre comisión+IVA de Stripe.
      const base = b.subtotalCents + b.ivaCents;
      expect(b.processingFeeCents).toBe(b.totalCents - base);
    });
  });

  describe('computeShipmentBreakdown', () => {
    it('taxes shipping fee with IVA, subtotal = shipping fee, fee includes Stripe IVA', () => {
      const b = computeShipmentBreakdown(17500, 16, fee);
      expect(b.subtotalCents).toBe(17500); // en retiros subtotal = tarifa de envío
      expect(b.ivaCents).toBe(2800); // 16% de 17500
      // base = 20300; total = ceil((20300 + 1.16*300)/0.95824) = ceil(21547.9) = 21548
      expect(b.totalCents).toBe(21548);
      expect(b.totalCents).toBe(b.subtotalCents + b.ivaCents + b.processingFeeCents);
      const net = b.totalCents - stripeDeduction(b.totalCents);
      expect(net).toBeGreaterThanOrEqual(20300);
      expect(net).toBeLessThan(20300 + 1);
    });
  });
});

// v2.0 (P-48, §4.36.4): el bloque de `quoteAcquisition` (tabla por RAREZA con modos fixed/pct) se
// RETIRÓ con las reglas. Su sustituto —la CURVA DE COMPRA— se prueba en `money.pricing-curve.spec.ts`
// (precedencias) y en `common/pricing-curve.spec.ts` (la matemática y la prueba de mesa normativa).

describe('pricing helpers', () => {
  it('computeSalePriceCents = round(ref × (1+markup%))', () => {
    expect(computeSalePriceCents(10000, 15)).toBe(11500);
    expect(computeSalePriceCents(12345, 10)).toBe(13580); // round(13579.5)
  });

  it('computeAportacionCostCents = round(ref × pct%)', () => {
    expect(computeAportacionCostCents(10000, 70)).toBe(7000);
    expect(computeAportacionCostCents(12345, 70)).toBe(8642); // round(8641.5)
  });

  it('usdToMxnCents applies rate + buffer', () => {
    // 100 USD (10000c) × 18 × (1+3%) = 185400c
    expect(usdToMxnCents(10000, 18, 3)).toBe(185400);
  });
});
