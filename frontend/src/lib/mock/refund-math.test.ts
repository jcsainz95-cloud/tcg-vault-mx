/**
 * Vectores DORADOS compartidos con `backend/src/common/refund-math.spec.ts` (§M4-SHIP.4 / .15.5): el espejo del
 * mock tiene que dar exactamente lo que da el servidor. Si el backend cambia la fórmula, cambia su spec, y esta
 * copia de los vectores se pone roja: ésa es la señal de que el espejo hay que realinearlo.
 *
 * ⛔ El espejo NO calcula IVA (§M10-IVA.3): el IVA de la mercancía sale de `GOLDEN_MERCHANDISE_IVA_CENTS`. Lo que
 * era `orderRemainingRefundComponents` (cierre «faltan todas», PS-3) ya no vive en el front: el mock no lo usaba y
 * su única operación era restar IVA; lo sigue midiendo `backend/src/common/refund-math.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GOLDEN_MERCHANDISE_IVA_CENTS,
  caseRefundComponents,
  caseRefundContextOf,
  itemMissingAmountCents,
  itemMissingRefundComponents,
  manualRefundComponentsOf,
  merchandiseIvaCentsOf,
  subtractRefundComponents,
  type RefundOrderMoney,
} from './refund-math';

/** El ejemplo que se le enseña al dueño (§M4-SHIP.4): MX$500 + MX$300, envío MX$150, comisión MX$46.17. */
const ORDER: RefundOrderMoney = {
  subtotalCents: 80000,
  shippingFeeCents: 15000,
  processingFeeCents: 4617,
  ivaCents: 13103, // 95000 − round(95000·100/116), del servidor; ⛔ no se recalcula aquí
  ivaRatePct: 16,
  totalCents: 99617,
  priceConvention: 'IVA_INCLUSIVE',
};

describe('PS-2 (espejo) — `item_missing`: P + floor(F × P / G)', () => {
  it('falta la de MX$300 ⇒ 31458 exacto, con sus componentes (IVA dentro de la mercancía, envío 0)', () => {
    const c = itemMissingRefundComponents(ORDER, 30000);
    expect(c.amountCents).toBe(31458);
    expect(itemMissingAmountCents(ORDER, 30000)).toBe(31458);
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
    expect(itemMissingAmountCents(ORDER, 50000)).toBe(52430);
  });
});

describe('§M10-IVA.3 — el IVA del espejo se LEE de la tabla dorada, nunca se deriva', () => {
  it('los vectores que fija el servidor y las pruebas del mock están en la tabla, literales', () => {
    const t = GOLDEN_MERCHANDISE_IVA_CENTS[16];
    expect(t[30000]).toBe(4138); // backend/src/common/refund-math.spec.ts (PS-2)
    expect(t[32000]).toBe(4414); // pr-8002 · ord-4103 (m4-ship-refund-components.test.ts)
    expect(t[35000]).toBe(4828); // rc-9001 · ord-4102
    expect(t[50000]).toBe(6897);
  });

  it('⭐ cada `unitPriceCents` sembrado en el servidor falso tiene su vector (si no, el mock respondería 501)', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/mock/m4-ship.ts'), 'utf8');
    const precios = [...src.matchAll(/unitPriceCents:\s*([\d_]+)/g)].map((m) => Number(m[1].replace(/_/g, '')));
    expect(precios.length).toBeGreaterThan(5);
    const faltan = precios.filter((p) => GOLDEN_MERCHANDISE_IVA_CENTS[16][p] === undefined);
    expect(faltan).toEqual([]);
  });

  it('⛔ un importe sin vector NO se inventa: 501 `MOCK_GOLDEN_VECTOR_MISSING`; mercancía 0 ⇒ IVA 0', () => {
    expect(() => merchandiseIvaCentsOf(12345, 16)).toThrow(/sin vector dorado/);
    let caught: unknown = null;
    try {
      merchandiseIvaCentsOf(12345, 16);
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ status: 501, code: 'MOCK_GOLDEN_VECTOR_MISSING', details: { merchandiseCents: 12345, ivaRatePct: 16 } });
    expect(() => merchandiseIvaCentsOf(30000, 8)).toThrow(/sin vector dorado/);
    expect(merchandiseIvaCentsOf(0, 16)).toBe(0);
  });
});

describe('PS-26/PS-27 (espejo) — `caseRefundComponents(X)`: monótona, y el reparto Stripe/SPEI suma ±0', () => {
  const ctx = caseRefundContextOf(ORDER, 50000); // Q = 52430, fQ = 2430

  it('X ≤ Q: devolución de venta parcial (comisión proporcional, sin compensación)', () => {
    const c = caseRefundComponents(26215, ctx);
    expect(c.processingFeeCents).toBe(1215);
    expect(c.merchandiseCents).toBe(25000);
    expect(c.merchandiseIvaCents).toBe(3448);
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

  it('sobre los montos sembrados: la fila SPEI (A − stripe) no tiene componentes negativos y suma la de A ±0', () => {
    for (const A of [52430, 60000, 62430, 100000]) {
      for (const max of [0, 26215, 52430, 52431, 60000]) {
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
    // A = 60000 sobre Q = 52430 con solo 26215 disponibles en Stripe: IVA(50000) − IVA(25000) = 6897 − 3448.
    const spei = manualRefundComponentsOf(subtractRefundComponents(caseRefundComponents(60000, ctx), caseRefundComponents(26215, ctx)));
    expect(spei).toEqual({
      merchandiseCents: 25000,
      merchandiseIvaCents: 3449,
      processingFeeCents: 1215,
      compensationCents: 7570,
    });
  });
});
