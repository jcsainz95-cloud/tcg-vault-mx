import {
  computeCartBreakdown,
  computeShipmentBreakdown,
  grossUpTotal,
  quoteAcquisition,
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

describe('AcquisitionPricer — quoteAcquisition por RAREZA (ARCHITECTURE §4.2, v1.3.1)', () => {
  const RULES = {
    Common: { mode: 'fixed' as const, value: 50 },
    Uncommon: { mode: 'fixed' as const, value: 50 },
    'Reverse Holo': { mode: 'fixed' as const, value: 150 },
  };
  const FALLBACK = 40;

  it('regla fixed → monto fijo, siempre cotiza (no depende de referencia)', () => {
    expect(quoteAcquisition('Common', 999999, RULES, FALLBACK)).toEqual({
      quotedPriceCents: 50,
      status: 'cotizada',
      appliedRule: { mode: 'fixed', value: 50 },
      ruleSource: 'rule',
    });
    // Reverse Holo fijo cotiza aun SIN referencia.
    expect(quoteAcquisition('Reverse Holo', null, RULES, FALLBACK)).toEqual({
      quotedPriceCents: 150,
      status: 'cotizada',
      appliedRule: { mode: 'fixed', value: 150 },
      ruleSource: 'rule',
    });
  });

  it('regla pct explícita → % de la referencia', () => {
    const rules = { 'Illustration Rare': { mode: 'pct' as const, value: 40 } };
    expect(quoteAcquisition('Illustration Rare', 12500, rules, FALLBACK)).toEqual({
      quotedPriceCents: 5000,
      status: 'cotizada',
      appliedRule: { mode: 'pct', value: 40 },
      ruleSource: 'rule',
    });
  });

  it('rareza SIN regla → fallback % (ruleSource=fallback), reproduce el antiguo ex_plus 40%', () => {
    expect(quoteAcquisition('Special Illustration Rare', 12500, RULES, FALLBACK)).toEqual({
      quotedPriceCents: 5000,
      status: 'cotizada',
      appliedRule: { mode: 'pct', value: 40 },
      ruleSource: 'fallback',
    });
    // rareza null también cae al fallback.
    expect(quoteAcquisition(null, 12500, RULES, FALLBACK).ruleSource).toBe('fallback');
  });

  it('pct (regla o fallback) SIN referencia → precio_pendiente (nunca se descarta)', () => {
    expect(quoteAcquisition('Illustration Rare', null, RULES, FALLBACK)).toEqual({
      quotedPriceCents: null,
      status: 'precio_pendiente',
      appliedRule: { mode: 'pct', value: 40 },
      ruleSource: 'fallback',
    });
  });

  it('pct redondea correctamente', () => {
    expect(quoteAcquisition('X', 12501, {}, 40).quotedPriceCents).toBe(5000); // round(5000.4)
    expect(quoteAcquisition('X', 12513, {}, 40).quotedPriceCents).toBe(5005); // round(5005.2)
  });
});

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
