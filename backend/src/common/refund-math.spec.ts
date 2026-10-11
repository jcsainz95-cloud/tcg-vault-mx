/**
 * §M4-SHIP.4 / §M4-SHIP.15.5 — la fórmula del reembolso, en unitaria y con el fixture del dueño.
 * PS-2 (importe exacto: `31458`, componentes; `damaged` ≡ `not_found`), PS-3 (identidad ±0 al cerrar),
 * PS-26/27 (componentes de `case_refund` y reparto Stripe/SPEI componente a componente, ±0).
 * Mutaciones que la ponen roja: `ceil` en la comisión; IVA con el dial vivo; `X > Q` sin compensación.
 */
import {
  itemFeeShareCents,
  RefundOrderMoney,
  caseRefundComponents,
  caseRefundContextOf,
  itemMissingRefundComponents,
  orderFullRefundComponents,
  orderRemainingRefundComponents,
  subtractRefundComponents,
  taxBaseCentsOf,
} from './money';

/** El ejemplo que se le enseña al dueño (§M4-SHIP.4): dos cartas MX$500 y MX$300, envío MX$150, comisión MX$46.17. */
const ORDER: RefundOrderMoney = {
  subtotalCents: 80000,
  shippingFeeCents: 15000,
  processingFeeCents: 4617,
  ivaCents: 95000 - taxBaseCentsOf(95000, 16),
  ivaRatePct: 16,
  totalCents: 99617,
  priceConvention: 'IVA_INCLUSIVE',
};

describe('PS-2 💰 — `item_missing`: P + floor(F × P / G)', () => {
  it('falta la de MX$300 ⇒ 31458 exacto, con sus componentes (IVA dentro de la mercancía, envío 0)', () => {
    const c = itemMissingRefundComponents(ORDER, 30000);
    expect(c.amountCents).toBe(31458);
    expect(c.merchandiseCents).toBe(30000);
    expect(c.processingFeeCents).toBe(1458);
    expect(c.shippingCents).toBe(0);
    expect(c.shippingIvaCents).toBe(0);
    expect(c.compensationCents).toBe(0);
    // MX$41.38 son IVA: 30000 − round(30000·100/116) = 30000 − 25862 = 4138.
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

describe('PS-3 💰 — «faltan todas»: Σ amountCents = totalCents y Σ IVA = ivaCents, ±0', () => {
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
    expect(close.amountCents).toBe(close.merchandiseCents + close.shippingCents + close.processingFeeCents);
  });

  it('`order_full` tras un reembolso por carta ⇒ amount = total − 31458 y la identidad del CHECK se cumple', () => {
    const r2 = itemMissingRefundComponents(ORDER, 30000);
    const full = orderFullRefundComponents(ORDER, [r2]);
    expect(full.amountCents).toBe(ORDER.totalCents - 31458);
    expect(full.amountCents).toBe(full.merchandiseCents + full.shippingCents + full.processingFeeCents);
    expect(full.shippingCents).toBe(15000);
    expect(full.processingFeeCents).toBe(4617 - 1458);
    expect(full.merchandiseCents).toBe(50000);
  });

  it('`order_full` sobre IVA_EXCLUSIVE: el IVA persistido entra DENTRO y la identidad se cumple igual', () => {
    const excl: RefundOrderMoney = {
      subtotalCents: 80000,
      shippingFeeCents: 15000,
      processingFeeCents: 4617,
      ivaCents: 15200,
      ivaRatePct: 16,
      totalCents: 80000 + 15000 + 15200 + 4617,
      priceConvention: 'IVA_EXCLUSIVE',
    };
    const full = orderFullRefundComponents(excl, []);
    expect(full.amountCents).toBe(excl.totalCents);
    expect(full.amountCents).toBe(full.merchandiseCents + full.shippingCents + full.processingFeeCents);
    expect(full.shippingCents).toBe(15000 + Math.round((15200 * 15000) / 95000));
  });
});

describe('PS-26/PS-27 💰 — `caseRefundComponents(X)`: monótona, y el reparto Stripe/SPEI suma ±0', () => {
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
});

describe('IMP-1 (QA sobre `c20451f`) — `floor` vs `ceil` se DISTINGUEN: cociente F·P/G no entero y Σ por carta ≤ F', () => {
  it('P=30001 ⇒ floor(4617·30001/95000)=1458 (ceil daría 1459)', () => {
    // 4617·30001/95000 = 1458.0486…: la fixture de PS-2 (30000 ⇒ 1458.0 exacto) no separa floor de ceil; ésta sí.
    expect(itemFeeShareCents(ORDER, 30001)).toBe(1458);
    expect(itemMissingRefundComponents(ORDER, 30001)).toMatchObject({ merchandiseCents: 30001, processingFeeCents: 1458, amountCents: 31459 });
  });

  it('Σ floor(F·Pᵢ/G) ≤ F con cifras que discriminan: tres cartas de 1 centavo, G=3, F=100 ⇒ 33+33+33 = 99 ≤ 100 (con ceil: 34·3 = 102 > F)', () => {
    const o = { subtotalCents: 3, shippingFeeCents: 0, processingFeeCents: 100 };
    const shares = [1, 1, 1].map((p) => itemFeeShareCents(o, p));
    expect(shares).toEqual([33, 33, 33]);
    const sum = shares.reduce((a, b) => a + b, 0);
    expect(sum).toBe(99);
    expect(sum).toBeLessThanOrEqual(o.processingFeeCents);
  });
});
