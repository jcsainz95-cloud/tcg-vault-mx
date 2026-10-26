import { describe, expect, it } from 'vitest';
import { appliedDiscountOfOrder } from './AmountBreakdown';

/**
 * §DSC.6 «Dónde se ve el pedido» (criterio 914) — `appliedDiscountOfOrder` lleva el `discount` de una orden YA hecha a la
 * forma del desglose. v1.110.3: «Subtotal antes del descuento» lo da el servidor (`merchandiseBeforeDiscountCents`) y se pinta
 * tal cual, `?? breakdown.subtotalCents`; ⛔ el front ya no suma `subtotalCents + discountCents` (DCO-F6, techlead R2).
 */
describe('appliedDiscountOfOrder · §DSC.6 (914)', () => {
  it('sin `discount` (criterio 915) ⇒ `null`: el desglose de hoy', () => {
    expect(appliedDiscountOfOrder({ subtotalCents: 140_800 }, undefined)).toBeNull();
    expect(appliedDiscountOfOrder({ subtotalCents: 140_800 }, null)).toBeNull();
  });

  it('10 %: subtotal antes, D y el código, tal cual del servidor', () => {
    expect(
      appliedDiscountOfOrder(
        { subtotalCents: 126_720 },
        { code: 'SEPT10', kind: 'percent', merchandiseBeforeDiscountCents: 140_800, discountCents: 14_080, shippingWaivedCents: 0 },
      ),
    ).toEqual({ outcome: 'applied', code: 'SEPT10', kind: 'percent', merchandiseBeforeDiscountCents: 140_800, discountCents: 14_080, shippingWaivedCents: 0 });
  });

  it('⛔ el «antes» es el campo del servidor, no una suma: con un campo que no cuadra, se pinta el campo (DCO-F6)', () => {
    // Datos a propósito incoherentes: si el helper volviera a sumar daría 140 800; el servidor dice 150 000 y manda él.
    const r = appliedDiscountOfOrder(
      { subtotalCents: 126_720 },
      { code: 'SEPT10', kind: 'percent', merchandiseBeforeDiscountCents: 150_000, discountCents: 14_080, shippingWaivedCents: 0 },
    );
    expect(r?.merchandiseBeforeDiscountCents).toBe(150_000);
  });

  it('servidor anterior a v1.110.3 (sin el campo) ⇒ `breakdown.subtotalCents`, sin sumar', () => {
    const legacy = { code: 'SEPT10', kind: 'percent', discountCents: 14_080, shippingWaivedCents: 0 } as unknown as Parameters<
      typeof appliedDiscountOfOrder
    >[1];
    expect(appliedDiscountOfOrder({ subtotalCents: 126_720 }, legacy)?.merchandiseBeforeDiscountCents).toBe(126_720);
  });

  it('envío gratis: la mercancía no cambia y `shippingWaivedCents` viaja tal cual', () => {
    expect(
      appliedDiscountOfOrder(
        { subtotalCents: 350_000 },
        { code: 'ENVIO25', kind: 'free_shipping', merchandiseBeforeDiscountCents: 350_000, discountCents: 0, shippingWaivedCents: 17_500 },
      ),
    ).toEqual({ outcome: 'applied', code: 'ENVIO25', kind: 'free_shipping', merchandiseBeforeDiscountCents: 350_000, discountCents: 0, shippingWaivedCents: 17_500 });
  });

  it('un código que no rebajó nada no pinta fila (como el correo, `discountMailRows`)', () => {
    expect(
      appliedDiscountOfOrder({ subtotalCents: 1_000 }, { code: 'X', kind: 'fixed_amount', merchandiseBeforeDiscountCents: 1_000, discountCents: 0, shippingWaivedCents: 0 }),
    ).toBeNull();
    expect(
      appliedDiscountOfOrder({ subtotalCents: 1_000 }, { code: 'Y', kind: 'free_shipping', merchandiseBeforeDiscountCents: 1_000, discountCents: 0, shippingWaivedCents: 0 }),
    ).toBeNull();
  });
});
