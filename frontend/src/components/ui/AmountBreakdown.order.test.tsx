import { describe, expect, it } from 'vitest';
import { appliedDiscountOfOrder } from './AmountBreakdown';

/**
 * §DSC.6 «Dónde se ve el pedido» (criterio 914) — `appliedDiscountOfOrder` lleva el `discount` de una orden YA hecha a la
 * forma del desglose. El único importe que no viaja tal cual es «Subtotal antes del descuento», y sale de la identidad del
 * contrato (§DSC.0 I-3): `subtotalCents` (Σ cobrado) + `discountCents` (Σ unidades × `unitDiscountCents`).
 */
describe('appliedDiscountOfOrder · §DSC.6 (914)', () => {
  it('sin `discount` (criterio 915) ⇒ `null`: el desglose de hoy', () => {
    expect(appliedDiscountOfOrder({ subtotalCents: 140_800 }, undefined)).toBeNull();
    expect(appliedDiscountOfOrder({ subtotalCents: 140_800 }, null)).toBeNull();
  });

  it('10 %: subtotal antes = cobrado + D; D y el código, tal cual del servidor', () => {
    expect(
      appliedDiscountOfOrder({ subtotalCents: 126_720 }, { code: 'SEPT10', kind: 'percent', discountCents: 14_080, shippingWaivedCents: 0 }),
    ).toEqual({ outcome: 'applied', code: 'SEPT10', kind: 'percent', merchandiseBeforeDiscountCents: 140_800, discountCents: 14_080, shippingWaivedCents: 0 });
  });

  it('envío gratis: la mercancía no cambia y `shippingWaivedCents` viaja tal cual', () => {
    expect(
      appliedDiscountOfOrder({ subtotalCents: 350_000 }, { code: 'ENVIO25', kind: 'free_shipping', discountCents: 0, shippingWaivedCents: 17_500 }),
    ).toEqual({ outcome: 'applied', code: 'ENVIO25', kind: 'free_shipping', merchandiseBeforeDiscountCents: 350_000, discountCents: 0, shippingWaivedCents: 17_500 });
  });

  it('un código que no rebajó nada no pinta fila (como el correo, `discountMailRows`)', () => {
    expect(appliedDiscountOfOrder({ subtotalCents: 1_000 }, { code: 'X', kind: 'fixed_amount', discountCents: 0, shippingWaivedCents: 0 })).toBeNull();
    expect(appliedDiscountOfOrder({ subtotalCents: 1_000 }, { code: 'Y', kind: 'free_shipping', discountCents: 0, shippingWaivedCents: 0 })).toBeNull();
  });
});
