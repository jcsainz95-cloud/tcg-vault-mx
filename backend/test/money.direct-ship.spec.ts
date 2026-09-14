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
  it('⭐ D56: el IVA es RESIDUAL del AGREGADO `G = S + E` y NO se apila detrás del exhibido', () => {
    // Los importes que entran ya son EXHIBIDOS (`S = Σ P`, `E = round(F×(1+t·r))`): 29000 y 20300
    // son el `25000`/`17500` de antes con el dial en 100 %.
    const b = computeDirectShipBreakdown(29000, 20300, IVA, FEE);
    expect(b.subtotalCents).toBe(29000);
    expect(b.shippingFeeCents).toBe(20300);
    // G = 49300 ⇒ taxBase = round(49300/1.16) = 42500 ⇒ iva = 6800, el MISMO importe de antes.
    expect(b.ivaCents).toBe(6800);
    expect(b.ivaRatePct).toBe(IVA);
    expect(b.priceConvention).toBe('IVA_INCLUSIVE');
    expect(b.ivaIncluded).toBe(true);
    expect(b.currency).toBe('MXN');
  });

  it('⭐⭐ `IVA-2`: el total es `grossUpTotal(S + E)` — ⛔ el IVA NO es un cuarto sumando', () => {
    const b = computeDirectShipBreakdown(29000, 20300, IVA, FEE);
    const grossUpBase = 29000 + 20300;
    expect(b.totalCents).toBe(grossUpTotal(grossUpBase, FEE));
    expect(b.processingFeeCents).toBe(b.totalCents - grossUpBase);
    // ⭐ La identidad (b) de §M10-IVA.4: cartas + envío + comisión. **Sin línea de IVA.**
    expect(b.totalCents).toBe(b.subtotalCents + b.shippingFeeCents + b.processingFeeCents);
    // ⛔ Y la mutación de `IVA-2`, nombrada: sumar el IVA a la base cobra 13.6 % de más.
    expect(b.totalCents).not.toBe(grossUpTotal(grossUpBase + b.ivaCents, FEE));
  });

  it('⛔ money-neutral: el total es EXACTAMENTE el de antes del corte con el dial en 100 %', () => {
    // Antes: base = 25000 + 17500 + round(42500×0.16) = 42500 + 6800 = 49300.
    // Ahora: G = round(25000×1.16) + round(17500×1.16) = 29000 + 20300 = 49300. **Idéntico.**
    const b = computeDirectShipBreakdown(29000, 20300, IVA, FEE);
    expect(b.totalCents).toBe(grossUpTotal(25000 + 17500 + 6800, FEE));
  });

  it('con envío 0 reproduce EXACTAMENTE el desglose de carrito de bóveda (no hay divergencia)', () => {
    const guest = computeDirectShipBreakdown(29000, 0, IVA, FEE);
    const cart = computeCartBreakdown(29000, IVA, FEE);
    expect(guest.ivaCents).toBe(cart.ivaCents);
    expect(guest.processingFeeCents).toBe(cart.processingFeeCents);
    expect(guest.totalCents).toBe(cart.totalCents);
  });

  it('cobra MÁS que el checkout de bóveda exactamente por el envío exhibido + su fee', () => {
    const guest = computeDirectShipBreakdown(29000, 20300, IVA, FEE);
    const cart = computeCartBreakdown(29000, IVA, FEE);
    expect(guest.totalCents).toBeGreaterThan(cart.totalCents);
    // El delta corresponde al envío exhibido con gross-up (no hay doble cobro de las cartas).
    const shipmentOnly = computeShipmentBreakdown(20300, IVA, FEE);
    expect(guest.totalCents - cart.totalCents).toBeLessThanOrEqual(shipmentOnly.totalCents);
  });

  it('todas las líneas son enteros de centavos (nunca floats)', () => {
    for (const subtotal of [1234, 25000, 999999]) {
      const b = computeDirectShipBreakdown(subtotal, 20300, IVA, FEE);
      for (const v of [b.subtotalCents, b.shippingFeeCents, b.ivaCents, b.processingFeeCents, b.totalCents]) {
        expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it('el envío NO se cuenta dos veces: el subtotal reportado sigue siendo solo cartas', () => {
    const b = computeDirectShipBreakdown(29000, 20300, IVA, FEE);
    // Regla de M7 (§12): el ingreso de envío vive en Order.shippingFeeCents, no dentro del subtotal.
    expect(b.subtotalCents).toBe(29000);
  });
});
