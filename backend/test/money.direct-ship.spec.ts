import {
  computeCartBreakdown,
  computeDirectShipBreakdown,
  computeShipmentBreakdown,
  grossUpTotal,
} from '../src/common/money';

const FEE = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const IVA = 16;

/**
 * v1.21-guest-checkout (§4-G.1/§4-G.2, ARCHITECTURE §4.21b) — el envío del invitado se cobra en el
 * MISMO PaymentIntent que las cartas. Esta suite fija la matemática del desglose y comprueba que
 * la función es ADITIVA (no altera los dos desgloses existentes).
 */
describe('computeDirectShipBreakdown — envío dentro de la misma orden', () => {
  it('grava con IVA el subtotal MÁS la tarifa de envío (ejemplo normativo del contrato)', () => {
    // §4-G.1: subtotal 25000 + envío 17500 → IVA 16% = 6800.
    const b = computeDirectShipBreakdown(25000, 17500, IVA, FEE);
    expect(b.subtotalCents).toBe(25000);
    expect(b.shippingFeeCents).toBe(17500);
    expect(b.ivaCents).toBe(6800);
    expect(b.ivaRatePct).toBe(IVA);
    expect(b.currency).toBe('MXN');
  });

  it('el total es el gross-up de (subtotal + envío + IVA) y el fee es la diferencia', () => {
    const b = computeDirectShipBreakdown(25000, 17500, IVA, FEE);
    const base = 25000 + 17500 + 6800;
    expect(b.totalCents).toBe(grossUpTotal(base, FEE));
    expect(b.processingFeeCents).toBe(b.totalCents - base);
    // El total cubre TODAS las líneas: cartas + envío + IVA + fee.
    expect(b.totalCents).toBe(b.subtotalCents + b.shippingFeeCents + b.ivaCents + b.processingFeeCents);
  });

  it('con envío 0 reproduce EXACTAMENTE el desglose de carrito de bóveda (no hay divergencia)', () => {
    const guest = computeDirectShipBreakdown(25000, 0, IVA, FEE);
    const cart = computeCartBreakdown(25000, IVA, FEE);
    expect(guest.ivaCents).toBe(cart.ivaCents);
    expect(guest.processingFeeCents).toBe(cart.processingFeeCents);
    expect(guest.totalCents).toBe(cart.totalCents);
  });

  it('cobra MÁS que el checkout de bóveda exactamente por el envío + su IVA + su fee', () => {
    const guest = computeDirectShipBreakdown(25000, 17500, IVA, FEE);
    const cart = computeCartBreakdown(25000, IVA, FEE);
    expect(guest.totalCents).toBeGreaterThan(cart.totalCents);
    // El delta corresponde al envío gravado y con gross-up (no hay doble cobro de las cartas).
    const shipmentOnly = computeShipmentBreakdown(17500, IVA, FEE);
    expect(guest.totalCents - cart.totalCents).toBeLessThanOrEqual(shipmentOnly.totalCents);
  });

  it('todas las líneas son enteros de centavos (nunca floats)', () => {
    for (const subtotal of [1234, 25000, 999999]) {
      const b = computeDirectShipBreakdown(subtotal, 17500, IVA, FEE);
      for (const v of [b.subtotalCents, b.shippingFeeCents, b.ivaCents, b.processingFeeCents, b.totalCents]) {
        expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it('el envío NO se cuenta dos veces: el subtotal reportado sigue siendo solo cartas', () => {
    const b = computeDirectShipBreakdown(25000, 17500, IVA, FEE);
    // Regla de M7 (§12): el ingreso de envío vive en Order.shippingFeeCents, no dentro del subtotal.
    expect(b.subtotalCents).toBe(25000);
  });
});
