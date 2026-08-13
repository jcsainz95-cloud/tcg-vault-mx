import {
  computeCartBreakdown,
  computeShipmentBreakdown,
  grossUpTotal,
  quoteAcquisition,
  computeSalePriceCents,
  computeAportacionCostCents,
  usdToMxnCents,
} from '../src/common/money';

describe('money — checkout formulas (ARCHITECTURE §5.1)', () => {
  const fee = { stripePct: 0.036, stripeFixedCents: 300 };

  describe('grossUpTotal', () => {
    it('recovers base integrally after Stripe commission', () => {
      const base = 100000; // MX$1000
      const total = grossUpTotal(base, fee);
      // total = ceil((100000 + 300) / (1 - 0.036)) = ceil(100300 / 0.964) = ceil(104045.6) = 104046
      expect(total).toBe(104046);
      // Plataforma recibe: total - (total*pct + fija) >= base
      const received = total - Math.round(total * fee.stripePct) - fee.stripeFixedCents;
      expect(received).toBeGreaterThanOrEqual(base - 1);
    });

    it('throws for pct out of range', () => {
      expect(() => grossUpTotal(1000, { stripePct: 1, stripeFixedCents: 0 })).toThrow();
    });
  });

  describe('computeCartBreakdown', () => {
    it('applies 16% IVA on subtotal and gross-up fee without extra IVA', () => {
      const b = computeCartBreakdown(100000, 16, fee);
      expect(b.subtotalCents).toBe(100000);
      expect(b.ivaCents).toBe(16000); // 16% de 100000
      expect(b.ivaRatePct).toBe(16);
      // base = 116000; total = ceil((116000+300)/0.964) = ceil(120643.15) = 120644
      expect(b.totalCents).toBe(120644);
      expect(b.processingFeeCents).toBe(b.totalCents - 116000);
      // total = subtotal + iva + fee
      expect(b.totalCents).toBe(b.subtotalCents + b.ivaCents + b.processingFeeCents);
      expect(b.currency).toBe('MXN');
    });

    it('fee line is not taxed with IVA (base = subtotal + iva only)', () => {
      const b = computeCartBreakdown(50000, 16, fee);
      const base = b.subtotalCents + b.ivaCents;
      expect(b.processingFeeCents).toBe(b.totalCents - base);
    });
  });

  describe('computeShipmentBreakdown', () => {
    it('taxes shipping fee with IVA, subtotal = shipping fee', () => {
      const b = computeShipmentBreakdown(17500, 16, fee);
      expect(b.subtotalCents).toBe(17500); // en retiros subtotal = tarifa de envío
      expect(b.ivaCents).toBe(2800); // 16% de 17500
      // base = 20300; total = ceil((20300+300)/0.964) = ceil(21369.3) = 21370
      expect(b.totalCents).toBe(21370);
      expect(b.totalCents).toBe(b.subtotalCents + b.ivaCents + b.processingFeeCents);
    });
  });
});

describe('AcquisitionPricer — quoteAcquisition (ARCHITECTURE §4.2)', () => {
  it('común = MX$0.50 (50c)', () => {
    expect(quoteAcquisition('comun', 999999)).toEqual({ quotedPriceCents: 50, status: 'cotizada' });
  });

  it('reverse_holo = MX$1.50 (150c)', () => {
    expect(quoteAcquisition('reverse_holo', null)).toEqual({
      quotedPriceCents: 150,
      status: 'cotizada',
    });
  });

  it('ex_plus = 40% de la referencia', () => {
    expect(quoteAcquisition('ex_plus', 12500)).toEqual({
      quotedPriceCents: 5000,
      status: 'cotizada',
    });
  });

  it('ex_plus sin referencia → precio_pendiente (nunca se descarta)', () => {
    expect(quoteAcquisition('ex_plus', null)).toEqual({
      quotedPriceCents: null,
      status: 'precio_pendiente',
    });
  });

  it('ex_plus redondea correctamente', () => {
    expect(quoteAcquisition('ex_plus', 12501).quotedPriceCents).toBe(5000); // round(5000.4)
    expect(quoteAcquisition('ex_plus', 12513).quotedPriceCents).toBe(5005); // round(5005.2)
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
