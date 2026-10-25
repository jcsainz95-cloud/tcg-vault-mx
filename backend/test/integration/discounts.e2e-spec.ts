/**
 * discounts.e2e-spec.ts — 💰 CÓDIGOS DE DESCUENTO, fase 1 (API_CONTRACT §DSC.0–§DSC.10) contra Postgres REAL, app Nest
 * completa por HTTP. Propiedad: backend. Escritas antes del código (sobre `85f350df` no compilan: el campo, las tablas y el
 * servicio no existen).
 *
 *  DCO-B19 (915) sin código ⇒ la respuesta de hoy: ⛔ `discount` y `unitDiscountCents` en ningún JSON; con un código
 *          inválido el quote es el de sin código + `discount: {outcome:'invalid'}` (campo a campo).
 *  DCO-B3  (892) quote y session con código ≡ la llamada de hoy con `S'` (bóveda %, directo %, monto fijo, envío gratis).
 *  DCO-B4  (895, 896) umbral sobre `S'`; envío gratis E = 0 / `shippingWaivedCents`; bóveda ⇒ NO_SHIPPING; S ≥ T ⇒ ALREADY_FREE.
 *  DCO-B5  (899) ciclo del uso: reserved → consumed; barrido, payment_failed, sustitución y compensación ⇒ released; reuso
 *          con el mismo código ⇒ misma orden y mismo PI; pago tardío ⇒ consumed + lateConsumed.
 *  DCO-B6  (900, N ≥ 10) la carrera del último uso: exactamente un `201` y un `422`, una fila. `DSC_RACE_N` fija N.
 *  DCO-B7/B8 (898, 907) límite por cliente con el correo normalizado; los seis genéricos con el mismo cuerpo.
 *  DCO-B9  (908) 10 fallidos ⇒ `rate_limited` / `429` + `Retry-After`; un `not_applicable` no suma.
 *  DCO-B10 (909) `endsAt` EXCLUSIVO con reloj fijo. DCO-B11 (910) pausar con un pago en curso.
 *  DCO-B16 (901, 902) `unitPriceCents` = cobrado; item_missing ×2 + remanente = total; order_full; item_delivered.
 *  DCO-B17 (917, 918) retiro con envío gratis: ceros, `picking`, 0 llamadas a Stripe, uso consumed; 10 % ⇒ 422 sin filas.
 *  DCO-B18 CHECKs de M-92 en Postgres (23514).
 *
 * Deterministas (N=1 dicho como tal) salvo DCO-B6. La tabla `DiscountCodeThrottle` se vacía antes de cada prueba: todas
 * las peticiones salen de la misma IP.
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { E2EHarness, ApiResponse } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { AccDb } from './helpers/accessories-b-db';
import { ShipPrepDb } from './helpers/ship-prep-db';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { DiscountsService } from '../../src/modules/discounts/discounts.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import {
  computeCartBreakdown,
  computeDirectShipBreakdown,
  displayPriceCentsOf,
  itemMissingRefundComponents,
  itemRefundComponents,
} from '../../src/common/money';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = `dsc${Date.now().toString(36)}`;
const TAG = RUN.slice(-6).toUpperCase();
const E_CARDS = 10000;
const T = 400000;
const RACE_N = Math.max(10, Number(process.env.DSC_RACE_N ?? 10));

type Body = Record<string, unknown>;
const omit = (o: Body, k: string) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k));

describe('💰 §DSC — códigos de descuento, fase 1 (Postgres real)', () => {
  let h: E2EHarness;
  let acc: AccDb;
  let prep: ShipPrepDb;
  let discounts: DiscountsService;
  let fee: Awaited<ReturnType<SettingsService['getStripeFee']>>;
  let adminId: string;
  const codeIds: string[] = [];
  let seq = 0;

  const mkCode = async (o: Partial<Parameters<DiscountsService['createCode']>[0]> & Pick<Parameters<DiscountsService['createCode']>[0], 'kind'>) => {
    seq += 1;
    const c = await discounts.createCode({ code: `D${TAG}-${seq}`, createdByUserId: adminId, ...o });
    codeIds.push(c.id);
    return c;
  };

  /** Pieza vendible cuyo `P` cotizado es `cents` (o el primero por encima, si `exact` es falso). Mismo fixture que ENV-*. */
  const piece = async (productType: 'raw' | 'graded' | 'sealed', cents: number, exact = false) => {
    let L = Math.floor(cents / 1.16) - 2;
    while (displayPriceCentsOf(L, 100, 16) < cents) L += 1;
    const P = displayPriceCentsOf(L, 100, 16);
    if (exact && P !== cents) throw new Error(`fixture: ningún L exhibe exactamente ${cents}`);
    const it = await acc.mkItem({ productType, listPriceCents: L });
    return { id: it.id, P };
  };

  /** Cliente CON cuenta (correo verificado) y su sesión. */
  const customer = async (email?: string) => {
    const u = await prep.mkUser('Cliente DSC', email ? { email } : {});
    return { user: u, token: await prep.loginCustomer(u.email as string) };
  };

  const vaultQuote = (token: string, json: Body) => h.api('POST', '/checkout/quote', { token, json });
  const vaultSession = async (token: string, json: Body) => {
    const r = await h.api('POST', '/checkout/session', { token, json });
    if (r.body?.orderId) prep.orders.push(r.body.orderId);
    return r;
  };
  const settle = (s: ApiResponse) => acc.settle(s);
  const redemptionOf = (orderId: string) => h.prisma.discountRedemption.findUnique({ where: { orderId } });
  const keysDeep = (v: unknown, out = new Set<string>()): Set<string> => {
    if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.add(k), keysDeep(x, out));
    return out;
  };

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    acc = new AccDb(h, RUN);
    await acc.init();
    prep = new ShipPrepDb(h, `${RUN}p`);
    await prep.init();
    discounts = h.app.get(DiscountsService);
    fee = await h.app.get(SettingsService).getStripeFee();
    adminId = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.admin.email } })).id;
  });

  afterAll(async () => {
    if (h) {
      const p = h.prisma;
      await p.discountRedemption.deleteMany({ where: { codeId: { in: codeIds } } });
      await p.discountCode.deleteMany({ where: { id: { in: codeIds } } });
      await p.discountCodeThrottle.deleteMany({});
      // Órdenes que ninguna respuesta devolvió (p. ej. la compensación del PI: 503 sin `orderId`) ⇒ a la limpieza de AccDb.
      const stray = await p.orderItem.findMany({ where: { inventoryItemId: { in: acc.items } }, select: { orderId: true } });
      for (const o of stray) if (!prep.orders.includes(o.orderId)) acc.orders.add(o.orderId);
      // Las piezas de AccDb que pasaron a la bóveda de un cliente de ShipPrepDb: se devuelven antes de borrar usuarios.
      await p.inventoryItem.updateMany({ where: { id: { in: acc.items } }, data: { reservedByOrderId: null, ownerType: 'platform', ownerUserId: null, ownershipStatus: null } });
    }
    await prep?.cleanup();
    await acc?.cleanup();
    await h?.close();
  });

  beforeEach(async () => {
    await h.prisma.discountCodeThrottle.deleteMany({});
    h.stripe.cancelOutcome = 'canceled';
  });

  // ================================================================ DCO-B19 · I-1

  describe('DCO-B19 (915) — sin código, la respuesta de hoy', () => {
    it('quote de invitado: sin `discount` ni `unitDiscountCents`; con código inválido = la misma + `discount: invalid`', async () => {
      const a = await piece('raw', 50000);
      const q0 = await acc.quote({ inventoryItemIds: [a.id] });
      expect(q0.status).toBe(200);
      const k = keysDeep(q0.body);
      for (const f of ['discount', 'unitDiscountCents', 'shippingWaivedCents']) expect(k.has(f)).toBe(false);
      const q1 = await acc.quote({ inventoryItemIds: [a.id], discountCode: `NOPE-${TAG}` });
      expect(q1.status).toBe(200);
      expect(q1.body.discount).toEqual({ outcome: 'invalid' });
      expect(omit(q1.body, 'discount')).toEqual(q0.body);
      // Vacío ⇒ como ausente: ni bloque ni intento fallido.
      const q2 = await acc.quote({ inventoryItemIds: [a.id], discountCode: '   ' });
      expect(q2.body).toEqual(q0.body);
    });

    it('quote de cuenta y quote de retiro: ídem', async () => {
      const c = await customer();
      const a = await piece('raw', 50000);
      const q0 = await vaultQuote(c.token, { inventoryItemIds: [a.id] });
      expect(keysDeep(q0.body).has('discount')).toBe(false);
      const q1 = await vaultQuote(c.token, { inventoryItemIds: [a.id], discountCode: `NOPE-${TAG}` });
      expect(q1.body.discount).toEqual({ outcome: 'invalid' });
      expect(omit(q1.body, 'discount')).toEqual(q0.body);

      const v = await prep.mkVaultOrder(c.user.id, { prices: [50000] });
      const address = await prep.mkAddress(c.user.id);
      const w0 = await h.api('POST', '/shipments/quote', { token: c.token, json: { inventoryItemIds: [v.pieces[0].id], addressId: address.id } });
      expect(w0.status).toBe(200);
      expect(keysDeep(w0.body).has('discount')).toBe(false);
      const w1 = await h.api('POST', '/shipments/quote', { token: c.token, json: { inventoryItemIds: [v.pieces[0].id], addressId: address.id, discountCode: `NOPE-${TAG}` } });
      expect(w1.body.discount).toEqual({ outcome: 'invalid' });
      expect(omit(w1.body, 'discount')).toEqual(w0.body);
    });

    it('sesiones sin código: las llaves de hoy, columnas nuevas en 0, sin fila de uso; detalle y seguimiento sin `discount`', async () => {
      const a = await piece('raw', 50000);
      const g = await acc.session({ inventoryItemIds: [a.id] });
      expect(g.status).toBe(201);
      expect(Object.keys(g.body).sort()).toEqual(
        ['accessoryLines', 'breakdown', 'checkoutToken', 'checkoutTokenExpiresAt', 'energyBundles', 'orderId', 'orderNumber', 'reservedUntil', 'reused', 'shippingBox', 'stripe', 'supersededOrderIds'].sort(),
      );
      expect(keysDeep(g.body).has('unitDiscountCents')).toBe(false);
      const row = await h.prisma.order.findUniqueOrThrow({ where: { id: g.body.orderId }, include: { items: true } });
      expect([row.discountCents, row.shippingWaivedCents, ...row.items.map((i) => i.unitDiscountCents)]).toEqual([0, 0, 0]);
      expect(await redemptionOf(g.body.orderId)).toBeNull();
      const t = await acc.track(g.body.checkoutToken);
      expect(t.status).toBe(200);
      expect(keysDeep(t.body).has('discount')).toBe(false);

      const c = await customer();
      const b = await piece('raw', 50000);
      const s = await vaultSession(c.token, { inventoryItemIds: [b.id] });
      expect(s.status).toBe(201);
      expect(Object.keys(s.body).sort()).toEqual(['breakdown', 'orderId', 'orderNumber', 'reservedUntil', 'reused', 'stripe', 'supersededOrderIds'].sort());
      const d = await h.api('GET', `/orders/${s.body.orderId}`, { token: c.token });
      expect(d.status).toBe(200);
      expect(keysDeep(d.body).has('discount')).toBe(false);
      expect(keysDeep(d.body).has('unitDiscountCents')).toBe(false);
    });
  });

  // ================================================================ DCO-B3 · I-2

  describe('DCO-B3 (892) — quote y session ≡ la llamada de hoy con S′ (4/4)', () => {
    it('bóveda 10 %: breakdown = computeCartBreakdown(S − D) en quote y en session; items cobrados y unitDiscountCents', async () => {
      const code = await mkCode({ kind: 'percent', percentPct: 10 });
      const c = await customer();
      const a = await piece('raw', 100000);
      const b = await piece('raw', 50000);
      const S = a.P + b.P;
      const D = Math.floor((S * 10) / 100);
      const expected = computeCartBreakdown(S - D, 16, fee);
      const q = await vaultQuote(c.token, { inventoryItemIds: [a.id, b.id], discountCode: code.code.toLowerCase() });
      expect(q.status).toBe(200);
      expect(q.body.discount).toEqual({ outcome: 'applied', code: code.code, kind: 'percent', merchandiseBeforeDiscountCents: S, discountCents: D, shippingWaivedCents: 0 });
      expect(q.body.breakdown).toEqual(expected);
      expect(q.body.items.reduce((s: number, i: { unitPriceCents: number }) => s + i.unitPriceCents, 0)).toBe(S - D);
      expect(q.body.items.reduce((s: number, i: { unitDiscountCents?: number }) => s + (i.unitDiscountCents ?? 0), 0)).toBe(D);
      const s = await vaultSession(c.token, { inventoryItemIds: [a.id, b.id], discountCode: code.code });
      expect(s.status).toBe(201);
      expect(s.body.breakdown).toEqual(expected);
      expect(s.body.discount).toEqual(q.body.discount);
      expect(h.stripe.createdIntents.find((pi) => pi.id === s.body.stripe.paymentIntentId)?.amountCents).toBe(expected.totalCents);
      const row = await h.prisma.order.findUniqueOrThrow({ where: { id: s.body.orderId }, include: { items: true } });
      expect(row.discountCents).toBe(D);
      expect(row.subtotalCents).toBe(S - D);
      expect(row.items.reduce((x, i) => x + i.unitPriceCents, 0)).toBe(row.subtotalCents);
      expect(row.items.reduce((x, i) => x + i.unitDiscountCents, 0)).toBe(D);
      expect((await redemptionOf(s.body.orderId))?.status).toBe('reserved');
      // 914: el detalle del cliente muestra el código y la rebaja por línea.
      const d = await h.api('GET', `/orders/${s.body.orderId}`, { token: c.token });
      expect(d.body.discount).toEqual({ code: code.code, kind: 'percent', discountCents: D, shippingWaivedCents: 0 });
    });

    it.each([
      ['directo 10 %', { kind: 'percent' as const, percentPct: 10 }, (S: number) => Math.floor((S * 10) / 100), E_CARDS],
      ['monto fijo 15000', { kind: 'fixed_amount' as const, amountCents: 15000 }, () => 15000, E_CARDS],
      ['envío gratis', { kind: 'free_shipping' as const }, () => 0, 0],
    ])('invitado %s: quote = session = computeDirectShipBreakdown(S′, E)', async (_n, def, dOf, E) => {
      const code = await mkCode(def);
      const a = await piece('raw', 120000);
      const S = a.P;
      const D = dOf(S);
      const expected = computeDirectShipBreakdown(S - D, E, 16, fee);
      const q = await acc.quote({ inventoryItemIds: [a.id], discountCode: code.code });
      expect(q.body.discount).toMatchObject({ outcome: 'applied', discountCents: D, shippingWaivedCents: def.kind === 'free_shipping' ? E_CARDS : 0 });
      expect(q.body.breakdown).toEqual(expected);
      if (def.kind === 'free_shipping') {
        expect(q.body.shippingRule).toMatchObject({ freeShippingApplied: true, freeShippingRemainingCents: null });
      }
      const s = await acc.session({ inventoryItemIds: [a.id], discountCode: code.code });
      expect(s.status).toBe(201);
      expect(s.body.breakdown).toEqual(expected);
      expect(s.body.discount).toEqual(q.body.discount);
      const row = await h.prisma.order.findUniqueOrThrow({ where: { id: s.body.orderId } });
      expect([row.discountCents, row.shippingWaivedCents, row.shippingFeeCents, row.totalCents]).toEqual([D, def.kind === 'free_shipping' ? E_CARDS : 0, E, expected.totalCents]);
      // 914: el seguimiento del invitado también lo muestra.
      const t = await acc.track(s.body.checkoutToken);
      expect(t.body.discount).toMatchObject({ code: code.code, discountCents: D });
    });
  });

  // ================================================================ DCO-B4

  describe('DCO-B4 (895, 896) — umbral sobre S′ y motivos del envío gratis', () => {
    it('420000 con 10 % ⇒ 378000 ⇒ E = 10000; 450000 ⇒ 405000 ⇒ E = 0', async () => {
      const code = await mkCode({ kind: 'percent', percentPct: 10, maxUsesPerCustomer: null });
      for (const [cents, E] of [[420000, E_CARDS], [450000, 0]] as const) {
        const a = await piece('raw', cents, true);
        const q = await acc.quote({ inventoryItemIds: [a.id], discountCode: code.code });
        const Sp = a.P - Math.floor(a.P / 10);
        expect(q.body.breakdown).toEqual(computeDirectShipBreakdown(Sp, E, 16, fee));
        expect(q.body.shippingRule.freeShippingRemainingCents).toBe(Math.max(0, T - Sp));
      }
    });

    it('envío gratis: bóveda ⇒ NO_SHIPPING; S ≥ T ⇒ ALREADY_FREE_SHIPPING; ninguno aparta uso', async () => {
      const code = await mkCode({ kind: 'free_shipping' });
      const c = await customer();
      const a = await piece('raw', 50000);
      const q = await vaultQuote(c.token, { inventoryItemIds: [a.id], discountCode: code.code });
      expect(q.body.discount).toEqual({ outcome: 'not_applicable', code: code.code, reason: 'NO_SHIPPING', details: {} });
      const s = await vaultSession(c.token, { inventoryItemIds: [a.id], discountCode: code.code });
      expect(s.status).toBe(422);
      expect(s.body.error).toMatchObject({ code: 'DISCOUNT_CODE_NOT_APPLICABLE', details: { reason: 'NO_SHIPPING' } });
      const big = await piece('raw', 410000);
      const g = await acc.session({ inventoryItemIds: [big.id], discountCode: code.code });
      expect(g.status).toBe(422);
      expect(g.body.error.details.reason).toBe('ALREADY_FREE_SHIPPING');
      expect(await h.prisma.discountRedemption.count({ where: { codeId: code.id } })).toBe(0);
    });
  });

  // ================================================================ DCO-B5

  describe('DCO-B5 (899) — ciclo del uso', () => {
    it('session ⇒ reserved; webhook ⇒ consumed (consumedAt)', async () => {
      const code = await mkCode({ kind: 'percent', percentPct: 10 });
      const a = await piece('raw', 50000);
      const s = await acc.session({ inventoryItemIds: [a.id], discountCode: code.code });
      expect(s.status).toBe(201);
      expect((await redemptionOf(s.body.orderId))?.status).toBe('reserved');
      expect((await h.prisma.discountCode.findUniqueOrThrow({ where: { id: code.id } })).firstReservedAt).not.toBeNull();
      await settle(s);
      const r = await redemptionOf(s.body.orderId);
      expect(r).toMatchObject({ status: 'consumed', lateConsumed: false });
      expect(r?.consumedAt).not.toBeNull();
    });

    it('barrido tras el TTL ⇒ released y el uso vuelve (el mismo cliente puede usarlo otra vez)', async () => {
      const code = await mkCode({ kind: 'percent', percentPct: 10, maxUsesPerCustomer: 1 });
      const email = acc.email('sweep');
      const a = await piece('raw', 50000);
      const s = await acc.session({ inventoryItemIds: [a.id], discountCode: code.code }, { email });
      expect(s.status).toBe(201);
      await h.app.get(OrdersService).sweepExpiredReservations(new Date(Date.now() + 6 * 3_600_000));
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: s.body.orderId } })).status).toBe('failed');
      expect((await redemptionOf(s.body.orderId))?.status).toBe('released');
      const b = await piece('raw', 50000);
      expect((await acc.session({ inventoryItemIds: [b.id], discountCode: code.code }, { email })).status).toBe(201);
    });

    it('payment_failed ⇒ released; un pago tardío que liquida ⇒ consumed + lateConsumed + bitácora', async () => {
      const code = await mkCode({ kind: 'percent', percentPct: 10 });
      const a = await piece('raw', 50000);
      const s = await acc.session({ inventoryItemIds: [a.id], discountCode: code.code });
      await acc.failPayment(s.body.stripe.paymentIntentId);
      expect((await redemptionOf(s.body.orderId))?.status).toBe('released');
      await settle(s);
      expect(await redemptionOf(s.body.orderId)).toMatchObject({ status: 'consumed', lateConsumed: true });
      expect(await h.prisma.auditLog.count({ where: { action: 'discount.redemption.late_consumed', entityId: s.body.orderId } })).toBe(1);
    });

    it('compensación: Stripe falla al crear el PI ⇒ 503, orden failed y uso released', async () => {
      const code = await mkCode({ kind: 'percent', percentPct: 10 });
      const a = await piece('raw', 50000);
      const spy = jest.spyOn(h.stripe, 'createPaymentIntent').mockRejectedValueOnce(new Error('e2e: stripe down'));
      try {
        const s = await acc.session({ inventoryItemIds: [a.id], discountCode: code.code });
        expect(s.status).toBe(503);
      } finally {
        spy.mockRestore();
      }
      const rows = await h.prisma.discountRedemption.findMany({ where: { codeId: code.id }, include: { order: { select: { status: true } } } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('released');
      expect(rows[0].order?.status).toBe('failed');
    });

    it('reuso con el MISMO código ⇒ 200, misma orden, mismo PI, una fila; con OTRO código ⇒ sustitución y el viejo released', async () => {
      const code = await mkCode({ kind: 'percent', percentPct: 10 });
      const other = await mkCode({ kind: 'fixed_amount', amountCents: 5000 });
      const email = acc.email('reuse');
      const a = await piece('raw', 50000);
      const s1 = await acc.session({ inventoryItemIds: [a.id], discountCode: code.code }, { email });
      expect(s1.status).toBe(201);
      const s2 = await acc.session({ inventoryItemIds: [a.id], discountCode: ` ${code.code.toLowerCase()} `, retryOfCheckoutToken: s1.body.checkoutToken }, { email });
      expect(s2.status).toBe(200);
      expect(s2.body).toMatchObject({ reused: true, orderId: s1.body.orderId, stripe: { paymentIntentId: s1.body.stripe.paymentIntentId } });
      expect(s2.body.discount).toEqual(s1.body.discount);
      expect(await h.prisma.discountRedemption.count({ where: { codeId: code.id } })).toBe(1);
      const s3 = await acc.session({ inventoryItemIds: [a.id], discountCode: other.code, retryOfCheckoutToken: s2.body.checkoutToken }, { email });
      expect(s3.status).toBe(201);
      expect(s3.body.supersededOrderIds).toEqual([s1.body.orderId]);
      expect((await redemptionOf(s1.body.orderId))?.status).toBe('released');
      expect((await redemptionOf(s3.body.orderId))).toMatchObject({ status: 'reserved', codeId: other.id });
      // Sin código ⇒ también sustituye (mismo código «o ninguno» en los dos lados).
      const s4 = await acc.session({ inventoryItemIds: [a.id], retryOfCheckoutToken: s3.body.checkoutToken }, { email });
      expect(s4.status).toBe(201);
      expect((await redemptionOf(s3.body.orderId))?.status).toBe('released');
      expect(s4.body.discount).toBeUndefined();
    });

    it('cuenta: el mismo carrito con el mismo código reusa; con otro código sustituye', async () => {
      const code = await mkCode({ kind: 'percent', percentPct: 10 });
      const c = await customer();
      const a = await piece('raw', 50000);
      const s1 = await vaultSession(c.token, { inventoryItemIds: [a.id], discountCode: code.code });
      const s2 = await vaultSession(c.token, { inventoryItemIds: [a.id], discountCode: code.code });
      expect(s2.status).toBe(200);
      expect(s2.body.orderId).toBe(s1.body.orderId);
      const s3 = await vaultSession(c.token, { inventoryItemIds: [a.id] });
      expect(s3.status).toBe(201);
      expect((await redemptionOf(s1.body.orderId))?.status).toBe('released');
    });
  });

  // ================================================================ DCO-B6

  describe(`DCO-B6 (900) — la carrera del último uso (N = ${RACE_N})`, () => {
    it('dos sesiones simultáneas de clientes distintos con 1 uso restante ⇒ exactamente un 201 y un 422, 1 fila', async () => {
      const outcomes: string[] = [];
      let ok = 0;
      for (let i = 0; i < RACE_N; i += 1) {
        // El perdedor recibe el genérico y CUENTA como intento fallido de la IP (§DSC.6): sin vaciar, con N > 10 la propia
        // carrera se bloquea con 429 (medido: N=30 ⇒ 10/30 y 20 pares 429/429).
        await h.prisma.discountCodeThrottle.deleteMany({});
        const code = await mkCode({ kind: 'percent', percentPct: 10, maxTotalUses: 1 });
        const [a, b] = [await piece('raw', 50000), await piece('raw', 50000)];
        const [r1, r2] = await Promise.all([
          acc.session({ inventoryItemIds: [a.id], discountCode: code.code }, { email: acc.email(`race${i}a`) }),
          acc.session({ inventoryItemIds: [b.id], discountCode: code.code }, { email: acc.email(`race${i}b`) }),
        ]);
        const statuses = [r1.status, r2.status].sort();
        const rows = await h.prisma.discountRedemption.count({ where: { codeId: code.id } });
        const loser = [r1, r2].find((r) => r.status === 422);
        const good = statuses[0] === 201 && statuses[1] === 422 && rows === 1 && loser?.body?.error?.code === 'DISCOUNT_CODE_INVALID';
        if (good) ok += 1;
        outcomes.push(`${statuses.join('/')}:${rows}`);
      }
      // eslint-disable-next-line no-console
      console.log(`DCO-B6 ${ok}/${RACE_N} [${outcomes.join(' ')}]`);
      expect(ok).toBe(RACE_N);
    });
  });

  // ================================================================ DCO-B7 / DCO-B8

  describe('DCO-B7 (898) — límite por cliente con el correo normalizado', () => {
    it('invitado Ana@… paga; ana@… ⇒ genérico; la cuenta con ese correo ⇒ genérico', async () => {
      const code = await mkCode({ kind: 'percent', percentPct: 10, maxUsesPerCustomer: 1 });
      const email = `Ana.${RUN}@Correo.mx`;
      const a = await piece('raw', 50000);
      const s = await acc.session({ inventoryItemIds: [a.id], discountCode: code.code }, { email });
      expect(s.status).toBe(201);
      await settle(s);
      const b = await piece('raw', 50000);
      const g = await acc.session({ inventoryItemIds: [b.id], discountCode: code.code }, { email: email.toLowerCase() });
      expect(g.status).toBe(422);
      expect(g.body.error.code).toBe('DISCOUNT_CODE_INVALID');
      const c = await customer(email.toLowerCase());
      const v = await vaultSession(c.token, { inventoryItemIds: [b.id], discountCode: code.code });
      expect(v.status).toBe(422);
      expect(v.body.error.code).toBe('DISCOUNT_CODE_INVALID');
      // y el quote del invitado con su correo lo dice antes (sin correo no conoce al cliente ⇒ applied)
      expect((await acc.quote({ inventoryItemIds: [b.id], discountCode: code.code, email: email.toLowerCase() })).body.discount).toEqual({ outcome: 'invalid' });
      await h.prisma.discountCodeThrottle.deleteMany({});
      expect((await acc.quote({ inventoryItemIds: [b.id], discountCode: code.code })).body.discount.outcome).toBe('applied');
    });
  });

  describe('DCO-B8 (907) — los seis genéricos: mismo estado y mismo cuerpo, en quote y en session', () => {
    it('no existe · archivado · pausado · fuera de vigencia · agotado · agotado para este cliente', async () => {
      const now = Date.now();
      const archived = await mkCode({ kind: 'percent', percentPct: 10 });
      await h.prisma.discountCode.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
      const paused = await mkCode({ kind: 'percent', percentPct: 10, status: 'paused' });
      const expired = await mkCode({ kind: 'percent', percentPct: 10, startsAt: new Date(now - 7_200_000), endsAt: new Date(now - 3_600_000) });
      const exhausted = await mkCode({ kind: 'percent', percentPct: 10, maxTotalUses: 1 });
      const mine = await mkCode({ kind: 'percent', percentPct: 10, maxUsesPerCustomer: 1 });
      const email = acc.email('six');
      const used1 = await piece('raw', 50000);
      expect((await acc.session({ inventoryItemIds: [used1.id], discountCode: exhausted.code })).status).toBe(201);
      const used2 = await piece('raw', 50000);
      expect((await acc.session({ inventoryItemIds: [used2.id], discountCode: mine.code }, { email })).status).toBe(201);
      const cases = [`NOEXISTE-${TAG}`, archived.code, paused.code, expired.code, exhausted.code, mine.code];
      const cart = await piece('raw', 50000);
      const quotes: string[] = [];
      const sessions: string[] = [];
      for (const c of cases) {
        await h.prisma.discountCodeThrottle.deleteMany({});
        const q = await acc.quote({ inventoryItemIds: [cart.id], discountCode: c, email });
        expect(q.status).toBe(200);
        quotes.push(q.text);
        await h.prisma.discountCodeThrottle.deleteMany({});
        const s = await acc.session({ inventoryItemIds: [cart.id], discountCode: c }, { email });
        expect(s.status).toBe(422);
        sessions.push(s.text);
      }
      expect(JSON.parse(quotes[0]).discount).toEqual({ outcome: 'invalid' });
      expect(new Set(quotes).size).toBe(1);
      expect(JSON.parse(sessions[0]).error).toMatchObject({ code: 'DISCOUNT_CODE_INVALID' });
      expect(JSON.parse(sessions[0]).error.details ?? {}).toEqual({});
      expect(new Set(sessions).size).toBe(1);
      // y ninguna sesión escribió: la pieza sigue libre.
      expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: cart.id } })).status).toBe('listed');
    });
  });

  // ================================================================ DCO-B9

  describe('DCO-B9 (908) — límite de intentos', () => {
    it('10 fallidos ⇒ el 11.º con código válido da rate_limited en quote y 429 + Retry-After en session; al vencer, aplica', async () => {
      const code = await mkCode({ kind: 'percent', percentPct: 10 });
      const a = await piece('raw', 50000);
      for (let i = 0; i < 10; i += 1) {
        const q = await acc.quote({ inventoryItemIds: [a.id], discountCode: `MALO-${TAG}-${i}` });
        expect(q.body.discount).toEqual({ outcome: 'invalid' });
      }
      const q = await acc.quote({ inventoryItemIds: [a.id], discountCode: code.code });
      expect(q.body.discount.outcome).toBe('rate_limited');
      expect(q.body.discount.retryAfterSeconds).toBeGreaterThan(0);
      const s = await acc.session({ inventoryItemIds: [a.id], discountCode: code.code });
      expect(s.status).toBe(429);
      expect(s.body.error).toMatchObject({ code: 'DISCOUNT_CODE_RATE_LIMITED' });
      expect(Number(s.headers['retry-after'])).toBeGreaterThan(0);
      expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('listed');
      // ⛔ sin IP ni correo en claro
      const keys = (await h.prisma.discountCodeThrottle.findMany()).map((r) => r.key);
      expect(keys.every((k) => /^(ip|email):[A-Za-z0-9_-]{20,}$|^user:/.test(k))).toBe(true);
      expect(keys.some((k) => k.includes('127.0.0.1'))).toBe(false);
      await h.prisma.discountCodeThrottle.updateMany({ data: { blockedUntil: new Date(Date.now() - 1000) } });
      expect((await acc.quote({ inventoryItemIds: [a.id], discountCode: code.code })).body.discount.outcome).toBe('applied');
    });

    it('un `not_applicable` no suma (12 seguidos y el válido sigue aplicando)', async () => {
      const na = await mkCode({ kind: 'percent', percentPct: 10, minSubtotalCents: 10_000_000 });
      const ok = await mkCode({ kind: 'percent', percentPct: 10 });
      const a = await piece('raw', 50000);
      for (let i = 0; i < 12; i += 1) {
        expect((await acc.quote({ inventoryItemIds: [a.id], discountCode: na.code })).body.discount.reason).toBe('MIN_SUBTOTAL');
      }
      expect((await acc.quote({ inventoryItemIds: [a.id], discountCode: ok.code })).body.discount.outcome).toBe('applied');
    });
  });

  // ================================================================ DCO-B10 / DCO-B11

  describe('DCO-B10 (909) — `endsAt` exclusivo con reloj fijo', () => {
    it('vale en endsAt − 1 ms y no en endsAt', async () => {
      const endsAt = new Date(Date.now() + 86_400_000);
      const code = await mkCode({ kind: 'percent', percentPct: 10, startsAt: new Date(Date.now() - 1000), endsAt });
      expect((await discounts.evaluate(h.prisma, code.code, {}, new Date(endsAt.getTime() - 1))).ok).toBe(true);
      expect((await discounts.evaluate(h.prisma, code.code, {}, endsAt)).ok).toBe(false);
      expect((await discounts.evaluate(h.prisma, code.code, {}, new Date(code.startsAt.getTime() - 1))).ok).toBe(false);
    });
  });

  describe('DCO-B11 (910) — pausar con un pago en curso', () => {
    it('el webhook consume el apartado; una sesión nueva ⇒ genérico; reanudar ⇒ aplica', async () => {
      const code = await mkCode({ kind: 'percent', percentPct: 10 });
      const a = await piece('raw', 50000);
      const s = await acc.session({ inventoryItemIds: [a.id], discountCode: code.code });
      await h.prisma.discountCode.update({ where: { id: code.id }, data: { status: 'paused' } });
      await settle(s);
      expect((await redemptionOf(s.body.orderId))?.status).toBe('consumed');
      const b = await piece('raw', 50000);
      const g = await acc.session({ inventoryItemIds: [b.id], discountCode: code.code });
      expect(g.status).toBe(422);
      expect(g.body.error.code).toBe('DISCOUNT_CODE_INVALID');
      await h.prisma.discountCode.update({ where: { id: code.id }, data: { status: 'active' } });
      await h.prisma.discountCodeThrottle.deleteMany({});
      expect((await acc.session({ inventoryItemIds: [b.id], discountCode: code.code })).status).toBe(201);
    });
  });

  // ================================================================ DCO-B16

  describe('DCO-B16 (901, 902) — los reembolsos devuelven lo COBRADO, nunca más; el uso no vuelve', () => {
    const paidWithCode = async (prices: number[], email = acc.email('rf')) => {
      const code = await mkCode({ kind: 'percent', percentPct: 10, maxUsesPerCustomer: 1 });
      const ps = [];
      for (const p of prices) ps.push(await piece('raw', p));
      const s = await acc.session({ inventoryItemIds: ps.map((p) => p.id), discountCode: code.code }, { email });
      if (s.status !== 201) throw new Error(`session ${s.status} ${s.text}`);
      await settle(s);
      const order = await h.prisma.order.findUniqueOrThrow({ where: { id: s.body.orderId }, include: { items: true } });
      const shipment = await h.prisma.shipmentRequest.findFirstOrThrow({ where: { orderId: order.id }, include: { items: true } });
      return { code, email, ps, s, order, shipment };
    };

    it('100000 + 50000 con 10 % ⇒ unitPriceCents 90000/45000; item_missing ×2 + remanente = totalCents; el mismo cliente ⇒ genérico', async () => {
      const r = await paidWithCode([100000, 50000]);
      const byItem = new Map(r.order.items.map((i) => [i.inventoryItemId, i]));
      for (const p of r.ps) {
        const oi = byItem.get(p.id)!;
        expect(oi.unitPriceCents + oi.unitDiscountCents).toBe(p.P);
        expect(oi.unitDiscountCents).toBe(Math.floor((p.P * 10) / 100));
      }
      const lines = r.shipment.items;
      const one = itemMissingRefundComponents(r.order, byItem.get(lines[0].inventoryItemId)!.unitPriceCents).amountCents;
      const original = itemMissingRefundComponents(r.order, r.ps.find((p) => p.id === lines[0].inventoryItemId)!.P).amountCents;
      expect(one).toBeLessThan(original);
      await acc.markCard(r.shipment.id, lines[0].id, { status: 'missing', missingReason: 'not_found' });
      const m = await acc.markCard(r.shipment.id, lines[1].id, { status: 'missing', missingReason: 'damaged' });
      expect(m.body.preparation.refundPreviewCents).toBe(r.order.totalCents);
      expect((await acc.prepare(r.shipment.id, r.order.totalCents)).status).toBe(200);
      const rows = await h.prisma.paymentRefund.findMany({ where: { orderId: r.order.id } });
      expect(rows.map((x) => x.kind).sort()).toEqual(['item_missing', 'item_missing', 'order_remaining']);
      expect(rows.reduce((a, x) => a + x.amountCents, 0)).toBe(r.order.totalCents);
      expect(rows.find((x) => x.shipmentItemId === lines[0].id)?.amountCents).toBe(one);
      expect((await redemptionOf(r.order.id))?.status).toBe('consumed');
      const again = await piece('raw', 50000);
      const g = await acc.session({ inventoryItemIds: [again.id], discountCode: r.code.code }, { email: r.email });
      expect(g.status).toBe(422);
      expect(g.body.error.code).toBe('DISCOUNT_CODE_INVALID');
    });

    it('order_full (M3) = totalCents cobrado; el uso sigue consumed', async () => {
      const r = await paidWithCode([100000]);
      const f = await acc.fullRefund(r.order.id);
      expect(f.status).toBeLessThan(300);
      const rows = await h.prisma.paymentRefund.findMany({ where: { orderId: r.order.id } });
      expect(rows.reduce((a, x) => a + x.amountCents, 0)).toBe(r.order.totalCents);
      expect((await redemptionOf(r.order.id))?.status).toBe('consumed');
    });

    it('panel de Stripe (stripe_dashboard) + remanente order_full = totalCents cobrado; el uso sigue consumed', async () => {
      const r = await paidWithCode([100000]);
      const pi = r.s.body.stripe.paymentIntentId as string;
      const w = await h.sendStripeWebhook({
        type: 'refund.updated',
        data: { object: { id: `re_dash_${randomUUID().slice(0, 8)}`, object: 'refund', amount: 10000, status: 'succeeded', payment_intent: pi, metadata: {}, created: Math.floor(Date.now() / 1000) } },
      });
      expect(w.status).toBe(200);
      h.stripe.seedStripeRefund(pi, { amountCents: 10000 });
      const dash = await h.prisma.paymentRefund.findFirstOrThrow({ where: { orderId: r.order.id, kind: 'stripe_dashboard' } });
      expect(dash.amountCents).toBe(10000);
      expect((await acc.fullRefund(r.order.id)).status).toBeLessThan(300);
      const rows = await h.prisma.paymentRefund.findMany({ where: { orderId: r.order.id } });
      expect(rows.find((x) => x.kind === 'order_full')?.amountCents).toBe(r.order.totalCents - 10000);
      expect(rows.reduce((a, x) => a + x.amountCents, 0)).toBe(r.order.totalCents);
      expect((await redemptionOf(r.order.id))?.status).toBe('consumed');
    });

    it('item_delivered (carta ya entregada) = itemRefundComponents sobre lo cobrado', async () => {
      const r = await paidWithCode([100000, 50000]);
      await acc.shipAll(r.shipment.id, 'entregado');
      const oi = r.order.items[0];
      const expected = itemRefundComponents(r.order, oi).amountCents;
      const res = await h.api('POST', `/admin/orders/${r.order.id}/items/${oi.id}/refund-delivered`, {
        token: acc.adminToken,
        json: { reason: 'arrived_damaged', note: 'llegó doblada, foto por correo', expectedRefundCents: expected },
      });
      expect(res.status).toBeLessThan(300);
      const row = await h.prisma.paymentRefund.findFirstOrThrow({ where: { orderId: r.order.id, kind: 'item_delivered' } });
      expect(row.amountCents).toBe(expected);
      expect(row.amountCents).toBeLessThan(itemRefundComponents(r.order, { unitPriceCents: oi.unitPriceCents + oi.unitDiscountCents }).amountCents);
      expect((await redemptionOf(r.order.id))?.status).toBe('consumed');
    });
  });

  // ================================================================ DCO-B17

  describe('DCO-B17 (917, 918) — retiro con código de envío gratis', () => {
    it('ceros, `picking`, stripe null, 0 PI, uso consumed, shippingWaivedCents = 20300; cancelar no llama a Stripe', async () => {
      const code = await mkCode({ kind: 'free_shipping' });
      const c = await customer();
      const v = await prep.mkVaultOrder(c.user.id, { prices: [50000] });
      const address = await prep.mkAddress(c.user.id);
      const json = { inventoryItemIds: [v.pieces[0].id], addressId: address.id, discountCode: code.code };
      const q = await h.api('POST', '/shipments/quote', { token: c.token, json });
      expect(q.body.discount).toEqual({ outcome: 'applied', code: code.code, kind: 'free_shipping', merchandiseBeforeDiscountCents: 0, discountCents: 0, shippingWaivedCents: 20300 });
      expect(q.body.breakdown).toMatchObject({ subtotalCents: 0, ivaCents: 0, processingFeeCents: 0, totalCents: 0 });
      const before = h.stripe.createdIntents.length;
      const s = await h.api('POST', '/shipments', { token: c.token, json });
      expect(s.status).toBe(201);
      expect(s.body).toMatchObject({ status: 'picking', stripe: null, breakdown: { totalCents: 0, subtotalCents: 0 } });
      expect(h.stripe.createdIntents.length).toBe(before);
      const row = await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id: s.body.shipmentId } });
      expect(row).toMatchObject({ status: 'picking', shippingFeeCents: 0, ivaCents: 0, processingFeeCents: 0, totalCents: 0, shippingWaivedCents: 20300, stripePaymentIntentId: null });
      expect(row.pickingAt).not.toBeNull();
      const red = await h.prisma.discountRedemption.findUniqueOrThrow({ where: { shipmentRequestId: row.id } });
      expect(red).toMatchObject({ status: 'consumed', customerUserId: c.user.id });
      const calls = h.stripe.callLog.length;
      const cancel = await h.api('PATCH', `/admin/shipments/${row.id}/status`, { token: prep.opToken, json: { to: 'cancelado' } });
      expect(cancel.status).toBe(409);
      expect(h.stripe.callLog.slice(calls).some((x) => x.startsWith('cancel:'))).toBe(false);
    });

    it('con 10 % ⇒ quote not_applicable con el cobro de hoy y POST 422 WITHDRAWAL_ONLY_FREE_SHIPPING sin filas', async () => {
      const code = await mkCode({ kind: 'percent', percentPct: 10 });
      const c = await customer();
      const v = await prep.mkVaultOrder(c.user.id, { prices: [50000] });
      const address = await prep.mkAddress(c.user.id);
      const base = { inventoryItemIds: [v.pieces[0].id], addressId: address.id };
      const q0 = await h.api('POST', '/shipments/quote', { token: c.token, json: base });
      const q = await h.api('POST', '/shipments/quote', { token: c.token, json: { ...base, discountCode: code.code } });
      expect(q.body.discount).toEqual({ outcome: 'not_applicable', code: code.code, reason: 'WITHDRAWAL_ONLY_FREE_SHIPPING', details: {} });
      expect(q.body.breakdown).toEqual(q0.body.breakdown);
      const s = await h.api('POST', '/shipments', { token: c.token, json: { ...base, discountCode: code.code } });
      expect(s.status).toBe(422);
      expect(s.body.error).toMatchObject({ code: 'DISCOUNT_CODE_NOT_APPLICABLE', details: { reason: 'WITHDRAWAL_ONLY_FREE_SHIPPING' } });
      expect(await h.prisma.shipmentRequest.count({ where: { userId: c.user.id } })).toBe(0);
      expect(await h.prisma.discountRedemption.count({ where: { codeId: code.id } })).toBe(0);
    });
  });

  // ================================================================ DCO-B18

  describe('DCO-B18 — CHECKs de M-92 (Postgres real)', () => {
    const ROLLBACK = Symbol('rollback');
    const sqlState = async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      try {
        await h.prisma.$transaction(async (tx) => {
          await fn(tx);
          throw ROLLBACK;
        });
        return 'ok';
      } catch (e) {
        if (e === ROLLBACK) return 'ok';
        // El NOMBRE del CHECK que saltó: sin él, un 23514 de otro CHECK (p. ej. la forma del paquete) pasaría por bueno.
        const text = `${String((e as { meta?: { code?: string } }).meta?.code ?? '')} ${(e as Error).message}`;
        const code = /\b(23\d{3})\b/.exec(text)?.[1] ?? '?';
        const name = /constraint "([^"]+)"/.exec(text)?.[1] ?? '?';
        return `${code}:${name}`;
      }
    };

    it('paquete con descuento, unidad en 0 con descuento y redención con pedido y retiro a la vez ⇒ 23514', async () => {
      const a = await piece('raw', 50000);
      const s = await acc.session({ inventoryItemIds: [a.id] });
      const orderId = s.body.orderId as string;
      expect(
        await sqlState((tx) => tx.$executeRaw`UPDATE "OrderItem" SET "unitPriceCents" = 0, "unitDiscountCents" = 1 WHERE "orderId" = ${orderId}`),
      ).toBe('23514:order_item_discount_shape');
      const oi = await h.prisma.orderItem.findFirstOrThrow({ where: { orderId }, select: { id: true } });
      expect(
        await sqlState((tx) =>
          tx.$executeRaw`INSERT INTO "OrderAccessoryLine" ("id","orderId","kind","quantity","unitPriceCents","snapshot","reservedUntil","unitDiscountCents","metaDeckId","metaDeckListId","deckSlug","deckName","deckOrderItemIds")
            VALUES (${randomUUID()}, ${orderId}, 'energy_bundle', 1, 2000, '{}'::jsonb, now(), 1, 'deck', 'list', 'slug', 'Deck', ARRAY[${oi.id}]::text[])`,
        ),
      ).toBe('23514:order_accessory_line_discount_shape');
      const code = await mkCode({ kind: 'percent', percentPct: 10 });
      const ship = await h.prisma.shipmentRequest.findFirst({ select: { id: true } });
      expect(ship).not.toBeNull();
      expect(
        await sqlState((tx) =>
          tx.$executeRaw`INSERT INTO "DiscountRedemption" ("id","codeId","orderId","shipmentRequestId","status","customerEmail")
            VALUES (${randomUUID()}, ${code.id}, ${orderId}, ${ship!.id}, 'reserved', 'x@y.z')`,
        ),
      ).toBe('23514:discount_redemption_subject');
      expect(
        await sqlState((tx) => tx.$executeRaw`UPDATE "DiscountCode" SET "code" = 'minúscula' WHERE "id" = ${code.id}`),
      ).toBe('23514:discount_code_text');
    });
  });
});
