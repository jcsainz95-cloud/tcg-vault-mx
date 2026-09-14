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
  /**
   * ⚠️⚠️ **D56 movió el UMBRAL, y se dice porque es un cambio de conducta medido, no un ajuste de
   * fixture.** Bajo `IVA_EXCLUSIVE` la base del gross-up era `S × 1.16`, así que `2e9` ya
   * desbordaba. Bajo `IVA_INCLUSIVE` **`G = S`** (el IVA va dentro), así que `2e9` **cabe**
   * (`grossUpTotal(2e9) ≈ 2.087e9 < MAX_CENTS`). ⛔ **El guardarraíl no se debilitó**: sigue
   * rechazando exactamente lo que no cabe en `Int32`, que es lo que tiene que medir. Lo que cambió
   * es el importe a partir del cual un total deja de ser representable — porque el total cambió.
   */
  const DESBORDA = 2_100_000_000;

  it('computeCartBreakdown con subtotal gigante lanza (no produce overflow persistible)', () => {
    expect(() => computeCartBreakdown(DESBORDA, 16, fee)).toThrow(/MAX_CENTS/);
  });

  it('computeDirectShipBreakdown con subtotal gigante lanza', () => {
    expect(() => computeDirectShipBreakdown(DESBORDA, 20300, 16, fee)).toThrow(/MAX_CENTS/);
  });

  it('computeShipmentBreakdown con tarifa gigante lanza', () => {
    expect(() => computeShipmentBreakdown(DESBORDA, 16, fee)).toThrow(/MAX_CENTS/);
  });

  it('⭐ el umbral sigue siendo EXACTAMENTE «el total no cabe», ni un centavo más laxo', () => {
    // Justo debajo del techo: pasa y el total cabe. Justo encima: lanza. Sin zona gris.
    const cabe = computeCartBreakdown(2_000_000_000, 16, fee);
    expect(cabe.totalCents).toBeLessThanOrEqual(MAX_CENTS);
    expect(() => computeCartBreakdown(DESBORDA, 16, fee)).toThrow(/MAX_CENTS/);
  });

  it('importes normales siguen intactos (sin throw, todos los campos <= MAX_CENTS)', () => {
    const b = computeCartBreakdown(116000, 16, fee);
    expect(b.subtotalCents).toBe(116000);
    expect(b.ivaCents).toBe(16000); // residual de 116000
    expect(b.totalCents).toBeLessThanOrEqual(MAX_CENTS);
    // ⭐ El total supera al subtotal SOLO por la comisión: el IVA ya está dentro.
    expect(b.totalCents).toBeGreaterThan(b.subtotalCents);
    expect(b.totalCents).toBe(b.subtotalCents + b.processingFeeCents);
    // direct-ship normal también intacto
    const d = computeDirectShipBreakdown(116000, 20300, 16, fee);
    expect(d.shippingFeeCents).toBe(20300);
    expect(d.totalCents).toBeLessThanOrEqual(MAX_CENTS);
  });
});
