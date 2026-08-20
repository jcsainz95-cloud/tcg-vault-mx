import {
  MAX_CENTS,
  grossUpTotal,
  computeCartBreakdown,
  computeShipmentBreakdown,
  computeDirectShipBreakdown,
  StripeFeeConfig,
} from './money';

/**
 * MS-2 (BE-27) — overflow de AGREGADOS `*Cents` (Int32). `grossUpTotal` es el choke point: todo
 * breakdown deriva su `totalCents` aquí y `total >= base >= subtotal`. Un agregado NO se clampa
 * (recortar = subcobro): si supera `MAX_CENTS` se **LANZA** para no reventar al persistir la Order.
 */
const fee: StripeFeeConfig = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };

describe('MS-2 — grossUpTotal rechaza agregados no representables en Int32', () => {
  it('lanza cuando el total gross-up excedería MAX_CENTS', () => {
    expect(() => grossUpTotal(MAX_CENTS, fee)).toThrow(/MAX_CENTS/);
  });

  it('el mensaje es explícito ("order amount not representable")', () => {
    expect(() => grossUpTotal(MAX_CENTS, fee)).toThrow(/not representable/i);
  });

  it('un base normal NO lanza y el total cabe en Int32', () => {
    const total = grossUpTotal(116000, fee);
    expect(total).toBeGreaterThan(116000);
    expect(total).toBeLessThanOrEqual(MAX_CENTS);
  });
});

describe('MS-2 — los breakdowns propagan el rechazo del agregado', () => {
  it('computeCartBreakdown con subtotal gigante lanza (no produce overflow persistible)', () => {
    expect(() => computeCartBreakdown(2_000_000_000, 16, fee)).toThrow(/MAX_CENTS/);
  });

  it('computeDirectShipBreakdown con subtotal gigante lanza', () => {
    expect(() => computeDirectShipBreakdown(2_000_000_000, 17500, 16, fee)).toThrow(/MAX_CENTS/);
  });

  it('computeShipmentBreakdown con tarifa gigante lanza', () => {
    expect(() => computeShipmentBreakdown(2_000_000_000, 16, fee)).toThrow(/MAX_CENTS/);
  });

  it('importes normales siguen intactos (sin throw, todos los campos <= MAX_CENTS)', () => {
    const b = computeCartBreakdown(100000, 16, fee);
    expect(b.subtotalCents).toBe(100000);
    expect(b.ivaCents).toBe(16000);
    expect(b.totalCents).toBeLessThanOrEqual(MAX_CENTS);
    expect(b.totalCents).toBeGreaterThan(b.subtotalCents + b.ivaCents);
    // direct-ship normal también intacto
    const d = computeDirectShipBreakdown(100000, 17500, 16, fee);
    expect(d.shippingFeeCents).toBe(17500);
    expect(d.totalCents).toBeLessThanOrEqual(MAX_CENTS);
  });
});
