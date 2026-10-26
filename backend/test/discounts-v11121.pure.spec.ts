/**
 * discounts-v11121.pure.spec.ts — 💰 contrato v1.112.1⟨arreglos-dsc⟩, la parte PURA/UNIDAD. Propiedad: backend.
 * Deterministas (N=1 dicho como tal). Escritas ANTES del código (rojas sobre `bdf5784c`).
 *
 *  DCO-B22 (§DSC.3, §DSC.4 puesto 8, I-7) `kind ≠ free_shipping ∧ D = 0` ⇒ `not_applicable/ZERO_DISCOUNT {}`; `preview` ⇒
 *          `{0,0,false}`. La parte de quote/session/intento/`firstReservedAt` vive en `test/integration/discounts.e2e-spec.ts`.
 *  §M4-VAULT.2-bis.2 (v1.112.1) el `succeeded` tardío sobre `refunded`/`chargeback` decide «con código» por la EXISTENCIA del
 *          `DiscountRedemption`, ⛔ no por importes.
 *  §4-G.12 punto 4 (v1.112.1, TL-ENV-2) `frozenShippingRuleOf`: `freeShippingRemainingCents = applied ? 0 : (¬box ∧ T > S ? T − S
 *          : null)`, `null` con código de envío gratis; los dos casos del contrato.
 */
import 'reflect-metadata';
import { DiscountCartLine, DiscountTerms } from '../src/common/money';
import { priceDirectShipCartWithCode, priceVaultCartWithCode } from '../src/modules/discounts/discount-pricing';
import { AdminDiscountsService } from '../src/modules/discounts/admin-discounts.service';
import { frozenShippingRuleOf } from '../src/modules/orders/frozen-breakdown';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { GuestOrderMailService } from '../src/modules/orders/guest-order-mail.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MailPort } from '../src/modules/mail/mail.port';

const FEE = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const DIALS = { cardsFeeCents: 10000, sealedFeeCents: 17500, freeFromCents: 400000 };
const terms = (t: Partial<DiscountTerms> & Pick<DiscountTerms, 'kind'>): DiscountTerms => ({
  percentPct: null,
  amountCents: null,
  maxDiscountCents: null,
  minSubtotalCents: null,
  productScopes: [],
  destinations: [],
  ...t,
});
const card = (id: string, P: number, type: DiscountCartLine['type'] = 'raw'): DiscountCartLine => ({ id, group: 'piece', type, unitPriceCents: P, quantity: 1 });
const accessory = (id: string, P: number, q = 1): DiscountCartLine => ({ id, group: 'accessory', type: 'accessory', unitPriceCents: P, quantity: q });
const ZERO = { outcome: 'not_applicable', reason: 'ZERO_DISCOUNT', details: {} };

describe('DCO-B22 (pura, v1.112.1) — ningún uso sin beneficio: `kind ≠ free_shipping ∧ D = 0` ⇒ ZERO_DISCOUNT {}', () => {
  const sealedShip = { kind: 'sealed' as const, dials: DIALS, choice: null };
  const cardsShip = { kind: 'cards_only' as const, dials: DIALS, choice: null };

  it('1 % con productScopes = [accessory], invitado directo, carta 50000 + accesorio 99 ⇒ ZERO_DISCOUNT (antes: applied 0 0)', () => {
    const r = priceDirectShipCartWithCode([card('c', 50000), accessory('acc:x:0', 99)], terms({ kind: 'percent', percentPct: 1, productScopes: ['accessory'] }), sealedShip, 16, FEE);
    expect(r).toEqual(ZERO);
  });

  it('fijo 2 sobre 3 energías de 1000 ⇒ ZERO_DISCOUNT (D0 = 2, el residuo no cabe en q = 3 ⇒ D = 0)', () => {
    const r = priceDirectShipCartWithCode([accessory('acc:e:0', 1000, 3)], terms({ kind: 'fixed_amount', amountCents: 2 }), sealedShip, 16, FEE);
    expect(r).toEqual(ZERO);
  });

  it('bóveda: 1 % solo a `graded` sobre una graded de 50 + carta de 50000 ⇒ ZERO_DISCOUNT (floor a 0)', () => {
    const r = priceVaultCartWithCode([card('g', 50, 'graded'), card('c', 50000)], terms({ kind: 'percent', percentPct: 1, productScopes: ['graded'] }), 16, FEE);
    expect(r).toEqual(ZERO);
  });

  it('B = U (toda unidad elegible vale 1 centavo) ⇒ ZERO_DISCOUNT', () => {
    const r = priceDirectShipCartWithCode([card('c', 50000), accessory('acc:x:0', 1, 2)], terms({ kind: 'percent', percentPct: 50, productScopes: ['accessory'] }), sealedShip, 16, FEE);
    expect(r).toEqual(ZERO);
  });

  it('precedencia: TOTAL_BELOW_MINIMUM (7) gana a ZERO_DISCOUNT (8) — bóveda, carta 99 con 1 %', () => {
    const r = priceVaultCartWithCode([card('c', 99)], terms({ kind: 'percent', percentPct: 1 }), 16, FEE);
    expect(r).toEqual({ outcome: 'not_applicable', reason: 'TOTAL_BELOW_MINIMUM', details: { minTotalCents: 1000 } });
  });

  it('D = 1 sigue aplicando (la regla es D = 0, no «poco»); envío gratis con D = 0 sigue aplicando (disjunto)', () => {
    const one = priceDirectShipCartWithCode([card('c', 50000), accessory('acc:x:0', 100)], terms({ kind: 'percent', percentPct: 1, productScopes: ['accessory'] }), sealedShip, 16, FEE);
    expect(one).toMatchObject({ outcome: 'applied', discountCents: 1 });
    const free = priceDirectShipCartWithCode([card('c', 50000)], terms({ kind: 'free_shipping' }), cardsShip, 16, FEE);
    expect(free).toMatchObject({ outcome: 'applied', discountCents: 0, shippingWaivedCents: 10000 });
  });

  describe('preview ⇒ { 0, 0, false }', () => {
    const admin = new AdminDiscountsService({} as never, {} as never);
    const preview = (body: Record<string, unknown>) => admin.preview(body, new Date('2026-10-26T12:00:00Z'));
    it('fijo 2 sobre 3 energías de 1000 (antes: { 0, 2, false })', () => {
      expect(preview({ kind: 'fixed_amount', amountCents: 2, sampleLines: [{ scope: 'accessory', priceCents: 1000, quantity: 3 }] })).toEqual({ discountCents: 0, nominalCents: 0, capped: false });
    });
    it('1 % solo a accesorios sobre accesorio de 99 + carta de 50000', () => {
      expect(
        preview({ kind: 'percent', percentPct: 1, productScopes: ['accessory'], sampleLines: [{ scope: 'raw', priceCents: 50000, quantity: 1 }, { scope: 'accessory', priceCents: 99, quantity: 1 }] }),
      ).toEqual({ discountCents: 0, nominalCents: 0, capped: false });
    });
    it('tope que se recorta a 0 por I-4 (todas las unidades de 1 centavo) ⇒ capped false', () => {
      expect(preview({ kind: 'percent', percentPct: 50, maxDiscountCents: 1, sampleLines: [{ scope: 'accessory', priceCents: 1, quantity: 3 }] })).toEqual({ discountCents: 0, nominalCents: 0, capped: false });
    });
  });
});

// ================================================================ pago tardío: «con código» ⇔ `DiscountRedemption`

describe('§M4-VAULT.2-bis.2 (v1.112.1) — el `succeeded` tardío decide «con código» por la existencia de `DiscountRedemption`', () => {
  const piOf = (amount: number) => ({ id: 'pi_1', amount, amount_received: amount, currency: 'mxn' }) as never;
  function harness(redemption: { id: string; status: string; codeId: string } | null) {
    const discountRedemption = {
      findUnique: jest.fn(async () => redemption),
      updateMany: jest.fn(async () => ({ count: redemption ? 1 : 0 })),
    };
    const prisma = {
      order: { findUnique: jest.fn() },
      discountRedemption,
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({ discountRedemption })),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const svc = new PaymentsService(
      prisma as unknown as PrismaService,
      { getCardDetails: jest.fn() } as unknown as StripeService,
      { sendConfirmation: jest.fn() } as unknown as GuestOrderMailService,
      audit as unknown as AuditService,
      { send: jest.fn() } as unknown as MailPort,
    );
    jest.spyOn((svc as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
    return { svc, prisma, discountRedemption, audit };
  }
  const order = (over: Record<string, unknown>) => ({
    id: 'o1',
    orderNumber: 'TCG-000001',
    status: 'refunded',
    totalCents: 1000,
    discountCents: 0,
    shippingWaivedCents: 0,
    items: [],
    accessoryLines: [],
    ...over,
  });

  it.each(['refunded', 'chargeback'])('%s con uso apartado y las DOS columnas en 0 ⇒ el uso se consume (antes: ni se miraba)', async (status) => {
    const h = harness({ id: 'r1', status: 'reserved', codeId: 'c1' });
    h.prisma.order.findUnique.mockResolvedValue(order({ status }));
    await h.svc.onPaymentSucceeded(piOf(1000));
    expect(h.discountRedemption.updateMany).toHaveBeenCalledTimes(1);
    expect(h.discountRedemption.updateMany.mock.calls[0]).toEqual([
      expect.objectContaining({ where: { id: 'r1', status: 'reserved' }, data: expect.objectContaining({ status: 'consumed' }) }),
    ]);
  });

  it('importes > 0 pero SIN `DiscountRedemption` ⇒ cero escrituras (los importes no deciden)', async () => {
    const h = harness(null);
    h.prisma.order.findUnique.mockResolvedValue(order({ discountCents: 500, shippingWaivedCents: 10000 }));
    await h.svc.onPaymentSucceeded(piOf(1000));
    expect(h.discountRedemption.updateMany).toHaveBeenCalledTimes(0);
    expect(h.audit.log).toHaveBeenCalledTimes(0);
  });

  it('venía de `released` ⇒ consumed + lateConsumed y la fila `discount.redemption.late_consumed`', async () => {
    const h = harness({ id: 'r1', status: 'released', codeId: 'c1' });
    h.prisma.order.findUnique.mockResolvedValue(order({}));
    await h.svc.onPaymentSucceeded(piOf(1000));
    expect(h.discountRedemption.updateMany.mock.calls[0]).toEqual([expect.objectContaining({ data: expect.objectContaining({ status: 'consumed', lateConsumed: true }) })]);
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'discount.redemption.late_consumed' }));
  });
});

// ================================================================ §4-G.12 punto 4: «te faltan» del congelado

describe('§4-G.12 punto 4 (v1.112.1, TL-ENV-2) — `frozenShippingRuleOf`: «te faltan» del congelado con `T` vivo', () => {
  const row = (S: number, E: number, over: Record<string, unknown> = {}) =>
    ({ subtotalCents: S, shippingFeeCents: E, shippingWaivedCents: 0, shippingBoxSnapshot: null, ...over }) as Parameters<typeof frozenShippingRuleOf>[1];
  const dialsT = (T: number) => ({ ...DIALS, freeFromCents: T });

  it('caso 1: congelada S = 400000, E = 0, T 400000 → 500000 ⇒ applied:true, remaining:0, freeFromCents:500000 (antes: 100000)', () => {
    expect(frozenShippingRuleOf('cards_only', row(400000, 0), dialsT(500000), false)).toEqual({
      kind: 'cards_only',
      freeFromCents: 500000,
      freeShippingRemainingCents: 0,
      freeShippingApplied: true,
      boxFeeApplies: false,
    });
  });

  it('caso 2: congelada S = 350000, E = 10000, T → 300000 ⇒ applied:false, remaining:null (antes: 0, «te faltan 0» pagando envío)', () => {
    expect(frozenShippingRuleOf('cards_only', row(350000, 10000), dialsT(300000), false)).toEqual({
      kind: 'cards_only',
      freeFromCents: 300000,
      freeShippingRemainingCents: null,
      freeShippingApplied: false,
      boxFeeApplies: false,
    });
  });

  it('bajo T y pagando envío ⇒ «te faltan T − S»; caja grande congelada ⇒ null', () => {
    expect(frozenShippingRuleOf('cards_only', row(60000, 10000), DIALS, false).freeShippingRemainingCents).toBe(340000);
    const box = row(100000, 35000, { shippingBoxSnapshot: { customerFeeCents: 35000, baseFeeCents: 17500 } });
    expect(frozenShippingRuleOf('sealed', box, DIALS, false)).toMatchObject({ freeShippingRemainingCents: null, boxFeeApplies: true, freeShippingApplied: false });
  });

  it('código de envío gratis ⇒ remaining null (lo dice el código de la orden, ⛔ no los importes)', () => {
    expect(frozenShippingRuleOf('cards_only', row(60000, 0, { shippingWaivedCents: 10000 }), DIALS, true)).toMatchObject({ freeShippingApplied: true, freeShippingRemainingCents: null });
    // E = 0 con importes de envío perdonado pero SIN código de envío gratis en su `DiscountRedemption` ⇒ la fórmula (0).
    expect(frozenShippingRuleOf('cards_only', row(400000, 0, { shippingWaivedCents: 10000 }), DIALS, false).freeShippingRemainingCents).toBe(0);
  });

  it('invariante: freeShippingApplied ⇒ remaining ∈ {0, null} en una rejilla de S, E, T y caja', () => {
    for (const S of [1000, 299999, 300000, 400000, 600000])
      for (const E of [0, 10000, 35000])
        for (const T of [100000, 400000, 500000])
          for (const box of [false, true])
            for (const byCode of [false, true]) {
              const r = frozenShippingRuleOf('sealed', row(S, E, box ? { shippingBoxSnapshot: { customerFeeCents: 35000, baseFeeCents: 17500 } } : {}), dialsT(T), byCode);
              if (r.freeShippingApplied) expect([0, null]).toContain(r.freeShippingRemainingCents);
              if (r.freeShippingRemainingCents !== null) expect(r.freeShippingRemainingCents === 0 ? r.freeShippingApplied : !r.freeShippingApplied).toBe(true);
            }
  });
});
