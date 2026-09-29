/**
 * Vectores DORADOS compartidos con `backend/src/common/refund-math.spec.ts` (§M4-SHIP.4 / .15.5): el espejo del
 * mock tiene que dar exactamente lo que da el servidor. Si el backend cambia la fórmula, cambia su spec, y esta
 * copia de los vectores se pone roja: ésa es la señal de que el espejo hay que realinearlo.
 */
import { describe, expect, it } from 'vitest';
import {
  caseRefundComponents,
  caseRefundContextOf,
  itemMissingRefundComponents,
  manualRefundComponentsOf,
  orderRemainingRefundComponents,
  subtractRefundComponents,
  taxBaseCentsOf,
  type RefundOrderMoney,
} from './refund-math';

/** El ejemplo que se le enseña al dueño (§M4-SHIP.4): MX$500 + MX$300, envío MX$150, comisión MX$46.17. */
const ORDER: RefundOrderMoney = {
  subtotalCents: 80000,
  shippingFeeCents: 15000,
  processingFeeCents: 4617,
  ivaCents: 95000 - taxBaseCentsOf(95000, 16),
  ivaRatePct: 16,
  totalCents: 99617,
  priceConvention: 'IVA_INCLUSIVE',
};

describe('PS-2 (espejo) — `item_missing`: P + floor(F × P / G)', () => {
  it('falta la de MX$300 ⇒ 31458 exacto, con sus componentes (IVA dentro de la mercancía, envío 0)', () => {
    const c = itemMissingRefundComponents(ORDER, 30000);
    expect(c.amountCents).toBe(31458);
    expect(c.merchandiseCents).toBe(30000);
    expect(c.processingFeeCents).toBe(1458);
    expect(c.shippingCents).toBe(0);
    expect(c.shippingIvaCents).toBe(0);
    expect(c.compensationCents).toBe(0);
    expect(c.merchandiseIvaCents).toBe(4138);
    expect(c.amountCents).toBe(c.merchandiseCents + c.shippingCents + c.processingFeeCents + c.compensationCents);
  });

  it('`floor`, no `ceil`: la suma por carta NUNCA excede la comisión cobrada', () => {
    const a = itemMissingRefundComponents(ORDER, 50000).processingFeeCents;
    const b = itemMissingRefundComponents(ORDER, 30000).processingFeeCents;
    expect(a).toBe(2430);
    expect(b).toBe(1458);
    expect(a + b).toBeLessThanOrEqual(ORDER.processingFeeCents);
  });
});

describe('PS-3 (espejo) — «faltan todas»: Σ amountCents = 99617 y Σ IVA = ivaCents, ±0', () => {
  it('52430 + 31458 + cierre 15729 = 99617; el envío absorbe el centavo del IVA', () => {
    const r1 = itemMissingRefundComponents(ORDER, 50000);
    const r2 = itemMissingRefundComponents(ORDER, 30000);
    const close = orderRemainingRefundComponents(ORDER, [r1, r2]);
    expect(r1.amountCents).toBe(52430);
    expect(close.amountCents).toBe(15729);
    expect(close.shippingCents).toBe(15000);
    expect(close.processingFeeCents).toBe(729);
    expect(r1.amountCents + r2.amountCents + close.amountCents).toBe(ORDER.totalCents);
    const iva = [r1, r2, close].reduce((a, c) => a + c.merchandiseIvaCents + c.shippingIvaCents, 0);
    expect(iva).toBe(ORDER.ivaCents);
  });
});

describe('PS-26/PS-27 (espejo) — `caseRefundComponents(X)`: monótona, y el reparto Stripe/SPEI suma ±0', () => {
  const ctx = caseRefundContextOf(ORDER, 50000); // Q = 52430, fQ = 2430

  it('X ≤ Q: devolución de venta parcial (comisión proporcional, sin compensación)', () => {
    const c = caseRefundComponents(26215, ctx);
    expect(c.processingFeeCents).toBe(Math.floor((26215 * 2430) / 52430));
    expect(c.merchandiseCents).toBe(26215 - c.processingFeeCents);
    expect(c.compensationCents).toBe(0);
    expect(c.amountCents).toBe(c.merchandiseCents + c.processingFeeCents + c.compensationCents);
  });

  it('X = Q ⇒ exactamente los componentes de `item_missing`; X > Q ⇒ + compensación = X − Q', () => {
    expect(caseRefundComponents(52430, ctx)).toEqual(itemMissingRefundComponents(ORDER, 50000));
    const c = caseRefundComponents(62430, ctx);
    expect(c.compensationCents).toBe(10000);
    expect(c.merchandiseCents).toBe(50000);
    expect(c.processingFeeCents).toBe(2430);
  });

  it('para 200 montos: la fila SPEI (A − stripe) no tiene componentes negativos y suma la de A ±0', () => {
    for (let a = 1; a <= 200; a += 1) {
      const A = a * 613;
      for (const max of [0, 1, 26215, 52430, 52431, 60000]) {
        const stripe = Math.min(A, max);
        const whole = caseRefundComponents(A, ctx);
        const card = caseRefundComponents(stripe, ctx);
        const spei = subtractRefundComponents(whole, card);
        for (const v of Object.values(spei)) expect(v).toBeGreaterThanOrEqual(0);
        expect(card.amountCents + spei.amountCents).toBe(A);
        expect(spei.amountCents).toBe(spei.merchandiseCents + spei.processingFeeCents + spei.compensationCents);
      }
    }
  });

  it('la fila SPEI con Stripe corto (stripe < Q) LLEVA IVA y comisión — lo que el mock daba a 0 (deuda (a))', () => {
    // A = 60000 sobre Q = 52430 con solo 26215 disponibles en Stripe.
    const spei = manualRefundComponentsOf(subtractRefundComponents(caseRefundComponents(60000, ctx), caseRefundComponents(26215, ctx)));
    expect(spei).toEqual({
      merchandiseCents: 50000 - (26215 - 1215),
      merchandiseIvaCents: (50000 - taxBaseCentsOf(50000, 16)) - (25000 - taxBaseCentsOf(25000, 16)),
      processingFeeCents: 2430 - 1215,
      compensationCents: 7570,
    });
    expect(spei.merchandiseIvaCents).toBeGreaterThan(0);
    expect(spei.processingFeeCents).toBeGreaterThan(0);
  });
});
