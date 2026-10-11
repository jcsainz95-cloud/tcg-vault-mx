/**
 * 💰 v1.82 (API_CONTRACT §PNL.2/§PNL.3, DESIGN_SYSTEM §60.2) — unitarias de las piezas PURAS de los dos reembolsos tras la
 * entrega y de sus correos.
 *
 *  - `deliveredRefundDecision` / `deliveredRefundViewOf`: el orden de las guardas y el importe D-1 (`31458` para la carta de
 *    `30000` del fixture del dueño: `S=80000, E=15000, F=4617`). Un cuerpo para el verbo y la vista de M3.
 *  - `parseItemDeliveredBody`: 400 de forma (`reason` con `allowed`, `note` 3–500 tras trim, `expectedRefundCents`), y las
 *    llaves extra ignoradas (⛔ `amountCents` del cuerpo nunca se lee).
 *  - `refundReferenceOf` / `assertCapturedAmountWithinLimits`: R, 2R, kR y los códigos de siempre (un juego de topes).
 *  - ML-25 (§60.13): AV-12 `after_delivery` no dice «no salió» / «didn't ship» ni «reponer»; AV-14 `withdrawal_delivered`
 *    no dice «reponer» / «replace»; y cada variante nombra el motivo y «No tienes que regresarnos la carta».
 */
import { BusinessException } from '../src/common/business.exception';
import { itemMissingRefundComponents, itemRefundComponents, taxBaseCentsOf } from '../src/common/money';
import { deliveredRefundDecision, deliveredRefundViewOf, parseItemDeliveredBody } from '../src/modules/orders/item-delivered-refund';
import { clientRefundOf } from '../src/modules/orders/order-public-status';
import { assertCapturedAmountWithinLimits, refundConfirmationOf, refundReferenceOf } from '../src/modules/payments/refunds/refund-reference';
import { manualRefundAnnouncedTemplate, refundNoticeTemplate } from '../src/modules/payments/refunds/mail/refund-notice.templates';
import { WithdrawalDeliveredRefundService } from '../src/modules/payments/refunds/withdrawal-delivered-refund.service';

const ORDER = {
  fulfillmentMode: 'direct_ship' as const,
  status: 'settled' as const,
  priceConvention: 'IVA_INCLUSIVE' as const,
  subtotalCents: 80000,
  shippingFeeCents: 15000,
  processingFeeCents: 4617,
  ivaCents: 95000 - taxBaseCentsOf(95000, 16),
  ivaRatePct: 16,
  totalCents: 99617,
};
const LINE = { id: 'si-1', shipmentRequestId: 'sr-1', inventoryItemId: 'p-1' };

function codeOf(fn: () => unknown): { status: number; code: string; details: Record<string, unknown> } {
  try {
    fn();
  } catch (e) {
    const ex = e as BusinessException;
    const r = ex.getResponse() as { error?: { code: string; details?: Record<string, unknown> }; code?: string; details?: Record<string, unknown> };
    const err = r.error ?? (r as { code: string; details?: Record<string, unknown> });
    return { status: ex.getStatus(), code: err.code, details: err.details ?? {} };
  }
  throw new Error('no lanzó');
}

describe('§PNL.2 — deliveredRefundDecision (un cuerpo para el verbo y M3)', () => {
  it('IDR-1 (pura): la carta de 30000 ⇒ 31458 = 30000 + 1458, envío 0 — la fórmula de item_missing (D-1)', () => {
    const d = deliveredRefundDecision(ORDER, { unitPriceCents: 30000 }, null, LINE);
    expect(d.kind).toBe('refundable');
    if (d.kind !== 'refundable') return;
    expect(d.components).toEqual(itemMissingRefundComponents(ORDER, 30000));
    expect(d.components.amountCents).toBe(31458);
    expect(d.components.merchandiseCents).toBe(30000);
    expect(d.components.processingFeeCents).toBe(1458);
    expect(d.components.shippingCents).toBe(0);
    expect(itemRefundComponents(ORDER, { unitPriceCents: 30000 })).toEqual(d.components);
    expect(d.line).toBe(LINE);
  });

  it('las guardas en el orden del contrato: not_direct_ship → order_not_settled → legacy_convention → already_refunded → not_delivered', () => {
    const r = (o: Partial<typeof ORDER>, existing: { id: string } | null, line: typeof LINE | null) =>
      deliveredRefundDecision({ ...ORDER, ...o } as typeof ORDER, { unitPriceCents: 30000 }, existing, line);
    // todo mal a la vez ⇒ gana la primera
    expect(r({ fulfillmentMode: 'vault' as never, status: 'refunded' as never, priceConvention: 'IVA_EXCLUSIVE' as never }, { id: 'x' }, null)).toEqual({ kind: 'blocked', reason: 'not_direct_ship' });
    expect(r({ status: 'refunded' as never, priceConvention: 'IVA_EXCLUSIVE' as never }, { id: 'x' }, null)).toEqual({ kind: 'blocked', reason: 'order_not_settled' });
    expect(r({ priceConvention: 'IVA_EXCLUSIVE' as never }, { id: 'x' }, null)).toEqual({ kind: 'blocked', reason: 'legacy_convention' });
    expect(r({}, { id: 'x' }, null)).toEqual({ kind: 'already_refunded', refundId: 'x' });
    expect(r({}, null, null)).toEqual({ kind: 'blocked', reason: 'not_delivered' });
  });

  it('IDR-15 (pura): la vista de M3 — refundable con la MISMA cifra; not_refundable con su motivo; null si ya hay fila', () => {
    expect(deliveredRefundViewOf(ORDER, { unitPriceCents: 30000 }, null, LINE)).toEqual({ kind: 'refundable', amountCents: 31458 });
    expect(deliveredRefundViewOf(ORDER, { unitPriceCents: 30000 }, null, null)).toEqual({ kind: 'not_refundable', reason: 'not_delivered' });
    expect(deliveredRefundViewOf({ ...ORDER, fulfillmentMode: 'vault' as never }, { unitPriceCents: 30000 }, null, LINE)).toEqual({ kind: 'not_refundable', reason: 'not_direct_ship' });
    expect(deliveredRefundViewOf(ORDER, { unitPriceCents: 30000 }, { id: 'r' }, LINE)).toBeNull();
  });
});

describe('§PNL.2 — parseItemDeliveredBody (400 de forma)', () => {
  const ok = { reason: 'arrived_damaged', note: '  llegó doblada  ', expectedRefundCents: 31458 };
  it('cuerpo válido: nota recortada; llaves extra ignoradas (⛔ `amountCents` no se lee)', () => {
    expect(parseItemDeliveredBody({ ...ok, amountCents: 1 })).toEqual({ reason: 'arrived_damaged', note: 'llegó doblada', expectedRefundCents: 31458 });
  });
  it('IDR-12: reason fuera del dominio ⇒ 400 {field:reason, allowed}; nota de 2 y de 501 ⇒ 400 {field:note}', () => {
    const e1 = codeOf(() => parseItemDeliveredBody({ ...ok, reason: 'lost' }));
    expect(e1).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', details: { field: 'reason', allowed: ['not_arrived', 'arrived_damaged'] } });
    expect(codeOf(() => parseItemDeliveredBody({ ...ok, note: ' ab ' }))).toMatchObject({ status: 400, details: { field: 'note' } });
    expect(codeOf(() => parseItemDeliveredBody({ ...ok, note: 'x'.repeat(501) }))).toMatchObject({ status: 400, details: { field: 'note' } });
    expect(parseItemDeliveredBody({ ...ok, note: 'x'.repeat(500) }).note).toHaveLength(500);
    expect(codeOf(() => parseItemDeliveredBody({ ...ok, note: undefined }))).toMatchObject({ status: 400, details: { field: 'note' } });
  });
  it('expectedRefundCents: no entero / 0 / string ⇒ 400 {field:expectedRefundCents}', () => {
    for (const v of [314.58, 0, -1, '31458', null, 2147483648]) {
      expect(codeOf(() => parseItemDeliveredBody({ ...ok, expectedRefundCents: v }))).toMatchObject({ status: 400, details: { field: 'expectedRefundCents' } });
    }
  });
});

describe('§PNL.3 — referencias y topes: UN juego (el de «Por reponer»)', () => {
  it('R = max(Q, M); 2R; kR; sin Q usa M; sin nada ⇒ R = 0', () => {
    expect(refundReferenceOf(31458, { cents: 40000, capturedDate: '2026-10-05' }, 5)).toMatchObject({ referenceCents: 40000, confirmAboveCents: 80000, limitCents: 200000 });
    expect(refundReferenceOf(null, { cents: 40000, capturedDate: 'x' }, 5)).toMatchObject({ paidReferenceCents: null, referenceCents: 40000 });
    expect(refundReferenceOf(31458, null, 5)).toMatchObject({ referenceCents: 31458, confirmAboveCents: 62916 });
    expect(refundReferenceOf(null, null, 5).referenceCents).toBe(0);
  });
  it('WDR-2 (pura): 2R+1 sin confirmar ⇒ 422 CASE_REFUND_CONFIRMATION_REQUIRED; kR+1 ⇒ 422 CASE_REFUND_ABOVE_LIMIT; en el borde pasa', () => {
    const ref = refundReferenceOf(31458, null, 5);
    expect(assertCapturedAmountWithinLimits(62916, ref, undefined)).toBe('none');
    expect(codeOf(() => assertCapturedAmountWithinLimits(62917, ref, undefined))).toMatchObject({ status: 422, code: 'CASE_REFUND_CONFIRMATION_REQUIRED' });
    expect(assertCapturedAmountWithinLimits(62917, ref, true)).toBe('reinforced');
    expect(assertCapturedAmountWithinLimits(157290, ref, true)).toBe('reinforced');
    expect(codeOf(() => assertCapturedAmountWithinLimits(157291, ref, true))).toMatchObject({ status: 422, code: 'CASE_REFUND_ABOVE_LIMIT' });
    expect(refundConfirmationOf(157291, ref)).toBe('blocked');
  });
  it('parseBody: monto 1..2147483647 entero, nota 3–500, motivo cerrado, confirmAboveReference booleano', () => {
    const ok = { shipmentItemId: 'si', reason: 'not_arrived', note: 'no llegó', amountCents: 100 };
    expect(WithdrawalDeliveredRefundService.parseBody(ok)).toEqual(ok);
    expect(codeOf(() => WithdrawalDeliveredRefundService.parseBody({ ...ok, amountCents: 0 }))).toMatchObject({ status: 400, details: { field: 'amountCents' } });
    expect(codeOf(() => WithdrawalDeliveredRefundService.parseBody({ ...ok, amountCents: 2147483648 }))).toMatchObject({ details: { field: 'amountCents' } });
    expect(codeOf(() => WithdrawalDeliveredRefundService.parseBody({ ...ok, reason: 'damaged' }))).toMatchObject({ details: { field: 'reason' } });
    expect(codeOf(() => WithdrawalDeliveredRefundService.parseBody({ ...ok, note: 'no' }))).toMatchObject({ details: { field: 'note' } });
    expect(codeOf(() => WithdrawalDeliveredRefundService.parseBody({ ...ok, confirmAboveReference: 'yes' }))).toMatchObject({ details: { field: 'confirmAboveReference' } });
    expect(codeOf(() => WithdrawalDeliveredRefundService.parseBody({ ...ok, shipmentItemId: '' }))).toMatchObject({ details: { field: 'shipmentItemId' } });
  });
});

describe('§PNL.2 — `items[].refund` del cliente gana `kind` (frontend elige la línea por `kind`)', () => {
  const base = { status: 'succeeded', amountCents: 31458, submittedAt: new Date('2026-10-05T00:00:00Z'), succeededAt: new Date('2026-10-05T00:00:01Z') };
  it('item_delivered ⇒ after_delivery con el motivo de entrega; item_missing ⇒ missing_at_prep', () => {
    expect(clientRefundOf({ ...base, kind: 'item_delivered', missingReason: null, deliveredReason: 'arrived_damaged' })).toEqual({
      kind: 'after_delivery',
      amountCents: 31458,
      reason: 'arrived_damaged',
      refundedAt: '2026-10-05T00:00:01.000Z',
    });
    expect(clientRefundOf({ ...base, kind: 'item_missing', missingReason: 'damaged', deliveredReason: null })).toMatchObject({ kind: 'missing_at_prep', reason: 'damaged' });
    expect(clientRefundOf({ ...base, status: 'requested', kind: 'item_delivered', missingReason: null, deliveredReason: 'not_arrived' })).toBeNull();
  });
});

describe('ML-25 (DESIGN_SYSTEM §60.13) — las dos variantes no reusan la prosa de hoy', () => {
  const av12 = (reason: 'not_arrived' | 'arrived_damaged', locale: 'es' | 'en') =>
    refundNoticeTemplate(
      { reference: 'TH-1', orderNumber: 'TH-1', orderId: 'o1', cards: [{ name: 'Charizard', setName: 'Base', reason, amountCents: 31458 }], nothingShips: false, variant: 'item_delivered', totalCents: 31458 },
      locale,
    );
  it.each(['es', 'en'] as const)('AV-12 after_delivery (%s): sin «no salió»/«didn.t ship»/«reponer»; con el motivo y la carta que no vuelve', (l) => {
    for (const reason of ['not_arrived', 'arrived_damaged'] as const) {
      const m = av12(reason, l);
      const all = `${m.subject}\n${m.html}\n${m.text}`;
      expect(all).not.toMatch(/no sali|didn.t ship|could not ship|no pudo salir|repon|replace/i);
      if (l === 'es') {
        expect(m.text).toContain('Te devolvimos el dinero de una carta');
        expect(m.text).toContain(reason === 'not_arrived' ? 'que no llegó' : 'que llegó en mala condición');
        expect(m.text).toContain('No tienes que regresarnos la carta');
        expect(m.subject).toContain('Reembolso de TH-1');
      } else {
        expect(m.text).toContain(reason === 'not_arrived' ? "which didn't arrive" : 'which arrived in bad condition');
        expect(m.text).toContain("You don't need to send the card back");
      }
      expect(m.text).toMatch(/314\.58/);
    }
  });
  it.each(['es', 'en'] as const)('AV-14 withdrawal_delivered (%s): sin «reponer»/«replace» ni parte de tarjeta; con la carta, el motivo y la CLABE', (l) => {
    const withClabe = manualRefundAnnouncedTemplate(
      { transferCents: 40000, cardCents: 0, clabeMasked: '••••••••••••••1234', withdrawal: { reference: 'SR-9', cardName: 'Pikachu', reason: 'arrived_damaged' } },
      l,
    );
    const noClabe = manualRefundAnnouncedTemplate({ transferCents: 40000, cardCents: 0, clabeMasked: null, withdrawal: { reference: 'SR-9', cardName: 'Pikachu', reason: 'not_arrived' } }, l);
    for (const m of [withClabe, noClabe]) {
      const all = `${m.subject}\n${m.html}\n${m.text}`;
      expect(all).not.toMatch(/repon|replace|REGRESA A TU TARJETA|BACK TO YOUR CARD/i);
      expect(m.text).toContain('Pikachu');
    }
    if (l === 'es') {
      expect(withClabe.text).toContain('que llegó en mala condición');
      expect(withClabe.text).toContain('terminación 1234');
      expect(noClabe.text).toContain('que no llegó');
      expect(noClabe.text).toContain('regístrala en tu cuenta');
      expect(withClabe.text).toContain('No tienes que regresarnos la carta');
    } else {
      expect(withClabe.text).toContain('ending in 1234');
      expect(noClabe.text).toContain("which didn't arrive");
    }
  });
  it('sin variante, AV-12/AV-14 siguen diciendo lo de siempre (⛔ la prosa nueva no se filtra a «Por reponer»)', () => {
    const m = manualRefundAnnouncedTemplate({ transferCents: 100, cardCents: 50, clabeMasked: null }, 'es');
    expect(m.text).toContain('No pudimos reponer tu carta');
    const n = refundNoticeTemplate({ reference: 'TH-1', orderNumber: 'TH-1', cards: [{ name: 'X', setName: null, reason: 'damaged', amountCents: 1 }], nothingShips: false, variant: 'item_missing', totalCents: 1 }, 'es');
    expect(n.text).toContain('Una carta no salió');
  });
});
