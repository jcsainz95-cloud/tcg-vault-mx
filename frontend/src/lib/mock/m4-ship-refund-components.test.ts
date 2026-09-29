/**
 * Deuda §M4-SHIP (a) del techlead: el servidor falso recalculaba los `components` de las transferencias a mano y
 * ya divergía del real (`m4-ship.ts:1286,1300-1303` antes de este pase: IVA `0` y comisión `0`). Ahora salen del
 * espejo `refund-math` (vectores dorados en `refund-math.test.ts`) con el MISMO cuerpo que
 * `replacement-case.service` (`case_excess`: A − stripe componente a componente) y `manual-refund.service.toManual`
 * (`stripe_failed`: copia de la fila). Cifras a mano sobre las órdenes sembradas, para que un error del espejo
 * no se tape a sí mismo.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { mockCaseRefundPreview, mockRefundCase, mockRefundToManual, resetMockM4Ship } from './m4-ship';

beforeEach(() => {
  window.localStorage.clear(); // sin `tcg.role` ⇒ super_admin
  resetMockM4Ship();
});

describe('`stripe_failed` · `mockRefundToManual(pr-8002)` copia el desglose de la fila (ord-4103, Growlithe P=32000)', () => {
  it('40 000 > Q=33 533 ⇒ mercancía 32 000, IVA 4 414, comisión 1 533, compensación 6 467 (suma 40 000)', () => {
    // ord-4103: S=120 000, E=0, F=5 749, r=16 ⇒ fQ = floor(5749·32000/120000) = 1 533; Q = 33 533.
    // IVA de la mercancía = 32 000 − round(32000·100/116) = 32 000 − 27 586 = 4 414.
    const m = mockRefundToManual('pr-8002');
    expect(m.source).toBe('stripe_failed');
    expect(m.amountCents).toBe(40_000);
    expect(m.components).toEqual({ merchandiseCents: 32_000, merchandiseIvaCents: 4_414, processingFeeCents: 1_533, compensationCents: 6_467 });
    const c = m.components;
    expect(c.merchandiseCents + c.processingFeeCents + c.compensationCents).toBe(m.amountCents);
  });
});

describe('`case_excess` · `mockRefundCase(rc-9001)` reparte A − stripe componente a componente (ord-4102, P=35000)', () => {
  it('A=100 000 con 94 336 en Stripe ⇒ fila Stripe con los componentes de `item_missing` + compensación; SPEI solo compensación 5 664', () => {
    // ord-4102: S=90 000, E=0, F=4 336 ⇒ fQ = floor(4336·35000/90000) = 1 686; Q = 36 686; total 94 336 sin reembolsos.
    const preview = mockCaseRefundPreview('rc-9001', 100_000);
    expect(preview.caseStripeCents).toBe(94_336);
    expect(preview.manualCents).toBe(5_664);
    const res = mockRefundCase('rc-9001', {
      amountCents: 100_000,
      reason: 'Golden vectors',
      expectedStripeCents: preview.stripeCents!,
      expectedManualCents: preview.manualCents!,
      confirmAboveReference: true,
    });
    expect(res.outcome).toBe('refunded');
    const stripeRow = res.refunds.find((r) => r.kind === 'case_refund');
    expect(stripeRow?.amountCents).toBe(94_336);
    expect(res.manualRefunds).toHaveLength(1);
    const m = res.manualRefunds[0];
    expect(m.amountCents).toBe(5_664);
    // compA(100 000) = {35 000, 4 828, 1 686, 63 314}; compStripe(94 336) = {35 000, 4 828, 1 686, 57 650} ⇒ resta:
    expect(m.components).toEqual({ merchandiseCents: 0, merchandiseIvaCents: 0, processingFeeCents: 0, compensationCents: 5_664 });
  });
});
