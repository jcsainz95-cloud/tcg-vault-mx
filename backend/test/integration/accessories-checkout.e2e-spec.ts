/**
 * 💰 Stream (B) de accesorios — la COMPRA de invitado contra Postgres REAL, por HTTP y webhook firmado (§AC.4–§AC.8,
 * §AC.19.4). Pruebas escritas ANTES del código (§AC.14):
 *
 *  AC-B10 precio del servidor · AC-B11 pedido mixto, un cobro · AC-B12 importes de línea · AC-B13 carrera de la última
 *  unidad (N=10) · AC-B14 soltar · AC-B15 liquidar · AC-B16 / 749 sin bóveda y con sesión se rechaza · AC-B24/B25/B45/B46
 *  la caja · AC-B32/B34 paquete · AC-B33 carrera del paquete (N=10) · AC-B38 reuso · AC-B43 `unavailableAccessories` ·
 *  AC-B44 fotos del paquete · AC-B56 orden de existencias · AC-B57 `unavailableBundles[].index`.
 *
 * Las carreras se miden N=10 rondas y se reporta la proporción (O-3).
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { AccDb, FUNDA_DIMS, HUGE_DIMS, PLAYMAT_DIMS } from './helpers/accessories-b-db';
import { computeDirectShipBreakdown, taxBaseCentsOf } from '../../src/common/money';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { releaseAccessoryReservations } from '../../src/modules/orders/accessory-stock';
import { photoDTO } from '../../src/modules/accessories/accessory-dto';

const RUN = `acbc${Date.now().toString(36)}`;
const N = Number(process.env.ACB_RACE_N ?? 10);

describe('💰 Accesorios (B) — compra de invitado (§AC.4–§AC.8, Postgres real)', () => {
  let h: E2EHarness;
  let db: AccDb;
  let fee: Awaited<ReturnType<SettingsService['getStripeFee']>>;
  const bd = (subtotal: number, shipping: number) => computeDirectShipBreakdown(subtotal, shipping, 16, fee);
  const code = (r: { status: number; body: any }) => `${r.status}:${r.body?.error?.code ?? ''}`;
  const report = (id: string, outcomes: string[], ok: (o: string) => boolean) => {
    const k = outcomes.filter(ok).length;
    // eslint-disable-next-line no-console
    console.log(`[ACB-RACE ${id}] ${k}/${outcomes.length} · N=${outcomes.length} · ${outcomes.join(' | ')}`);
    return k;
  };

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    db = new AccDb(h, RUN);
    await db.init();
    fee = await h.app.get(SettingsService).getStripeFee();
  });

  afterAll(async () => {
    await db?.cleanup();
    await h?.close();
  });

  beforeEach(async () => {
    await db.clearBoxes();
  });

  // ================================================================ AC-B11 / AC-B10 / AC-B12 / AC-B43

  describe('AC-B11 pedido mixto, un solo cobro (criterio 708) e I-AC-1', () => {
    it('1 carta + 1 sellado + 2 accesorios: quote = Σ exhibidos + envío + comisión; session ⇒ UN PaymentIntent = totalCents', async () => {
      const card = await db.mkItem();
      const sealed = await db.mkItem({ productType: 'sealed' });
      const a = await db.mkAccessory({ priceCents: 8900, stockQty: 20, unitCostCents: 3000 });
      const b = await db.mkAccessory({ priceCents: 4500, stockQty: 5, category: 'toploaders' });
      const cart = { inventoryItemIds: [card.id, sealed.id], accessoryLines: [{ accessoryId: a.id, quantity: 2 }, { accessoryId: b.id, quantity: 1 }] };
      const q = await db.quote(cart);
      expect(q.status).toBe(200);
      const itemsSum = (q.body.items as { unitPriceCents: number }[]).reduce((s, i) => s + i.unitPriceCents, 0);
      expect(q.body.items).toHaveLength(2);
      const subtotal = itemsSum + 2 * 8900 + 4500;
      expect(q.body.breakdown).toEqual(bd(subtotal, db.eBase));
      expect(q.body.accessoryLines).toEqual([
        { accessoryId: a.id, name: a.name, category: 'sleeves', energyType: null, unitPriceCents: 8900, quantity: 2, lineTotalCents: 17800, photo: photoDTO(a.id, a.photoVersion) },
        { accessoryId: b.id, name: b.name, category: 'toploaders', energyType: null, unitPriceCents: 4500, quantity: 1, lineTotalCents: 4500, photo: photoDTO(b.id, b.photoVersion) },
      ]);
      expect(q.body.unavailableAccessories).toEqual([]);
      expect(q.body.energyBundles).toEqual([]);
      expect(q.body.energyBundleOffers).toEqual([]);
      expect(q.body.unavailableBundles).toEqual([]);
      expect(q.body.shippingBox).toBeNull();
      expect(q.body.vaultExcludesAccessories).toBe(true);
      // `vaultBreakdown` = solo cartas, como hoy.
      expect(q.body.vaultBreakdown.subtotalCents).toBe(itemsSum);

      const before = h.stripe.createdIntents.length;
      const s = await db.session(cart);
      expect(s.status).toBe(201);
      expect(s.body.breakdown).toEqual(q.body.breakdown);
      expect(h.stripe.createdIntents.length).toBe(before + 1);
      const pi = h.stripe.createdIntents[h.stripe.createdIntents.length - 1];
      expect(pi.amountCents).toBe(s.body.breakdown.totalCents);
      const order = await h.prisma.order.findUniqueOrThrow({ where: { id: s.body.orderId }, include: { items: true, accessoryLines: true } });
      // I-AC-1: subtotal = Σ OrderItem + Σ renglón × cantidad.
      expect(order.subtotalCents).toBe(order.items.reduce((x, i) => x + i.unitPriceCents, 0) + order.accessoryLines.reduce((x, l) => x + l.unitPriceCents * l.quantity, 0));
      expect(order.totalCents).toBe(pi.amountCents);
      expect(order.accessoryLines.map((l) => ({ k: l.kind, a: l.accessoryId, q: l.quantity, p: l.unitPriceCents, c: l.unitCostCents, st: l.status })).sort((x, y) => (x.p < y.p ? -1 : 1))).toEqual([
        { k: 'accessory', a: b.id, q: 1, p: 4500, c: 1000, st: 'reserved' },
        { k: 'accessory', a: a.id, q: 2, p: 8900, c: 3000, st: 'reserved' },
      ]);
      for (const l of order.accessoryLines) {
        expect(l.reservedUntil.getTime()).toBeGreaterThan(Date.now());
        expect(l.snapshot).toEqual(expect.objectContaining({ name: expect.any(String), category: expect.any(String) }));
        expect(JSON.stringify(l.snapshot)).not.toMatch(/price|cost/i);
      }
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 20, reservedQty: 2 });
      expect(await db.stockOf(b.id)).toEqual({ stockQty: 5, reservedQty: 1 });
      expect(s.body.accessoryLines).toHaveLength(2);
      expect(s.body.energyBundles).toEqual([]);
      expect(s.body.shippingBox).toBeNull();
    });

    it('solo accesorios (sin cartas): quote y session válidos; vaultBreakdown en ceros', async () => {
      const a = await db.mkAccessory({ priceCents: 8900, stockQty: 3 });
      const q = await db.quote({ accessoryLines: [{ accessoryId: a.id, quantity: 1 }] });
      expect(q.status).toBe(200);
      expect(q.body.items).toEqual([]);
      expect(q.body.breakdown).toEqual(bd(8900, db.eBase));
      expect(q.body.vaultBreakdown.subtotalCents).toBe(0);
      const s = await db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 1 }] });
      expect(s.status).toBe(201);
      expect(s.body.breakdown.totalCents).toBe(q.body.breakdown.totalCents);
    });
  });

  describe('AC-B10 I-AC-3: ningún importe sale del cuerpo (criterios 709, 727)', () => {
    it('precios y envío falsos en el cuerpo ⇒ los importes no cambian (quote y session)', async () => {
      const a = await db.mkAccessory({ priceCents: 8900, stockQty: 5 });
      await db.setBoxes([{ code: 'grande', l: 70, w: 40, h: 10, fee: 30000 }]);
      const clean = { accessoryLines: [{ accessoryId: a.id, quantity: 1 }] };
      const dirty = {
        accessoryLines: [{ accessoryId: a.id, quantity: 1, priceCents: 1, unitPriceCents: 1 }],
        priceCents: 1,
        shippingFeeCents: 1,
        breakdown: { totalCents: 1 },
      };
      const q1 = await db.quote(clean);
      const q2 = await db.quote(dirty);
      expect(q2.body.breakdown).toEqual(q1.body.breakdown);
      expect(q2.body.breakdown.shippingFeeCents).toBe(30000);
      const s = await db.session(dirty);
      expect(s.status).toBe(201);
      expect(s.body.breakdown).toEqual(q1.body.breakdown);
      const line = await h.prisma.orderAccessoryLine.findFirstOrThrow({ where: { orderId: s.body.orderId } });
      expect(line.unitPriceCents).toBe(8900);
    });
  });

  describe('AC-B12 importes de línea (criterios 701, 731)', () => {
    it('8 «Energía Fuego» a MX$5 ⇒ línea MX$40.00; IVA informado de la línea 552; el subtotal no suma IVA', async () => {
      const fire = await db.setEnergy('fire', { stockQty: 20 });
      const q = await db.quote({ accessoryLines: [{ accessoryId: fire, quantity: 8 }] });
      expect(q.body.accessoryLines[0]).toMatchObject({ accessoryId: fire, energyType: 'fire', category: 'energy', unitPriceCents: 500, quantity: 8, lineTotalCents: 4000 });
      expect(4000 - taxBaseCentsOf(4000, 16)).toBe(552);
      expect(q.body.breakdown).toEqual(bd(4000, db.eBase));
    });
  });

  describe('AC-B43 unavailableAccessories (v1.86.1) y AC-B3 (quote sin costo, existencias ni medidas)', () => {
    it('inexistente ⇒ name null · inactivo ⇒ su nombre · agotado ⇒ sold_out · corto ⇒ insufficient {availableQty}; lista blanca', async () => {
      const inactive = await db.mkAccessory({ priceCents: 1000, stockQty: 5, active: false, name: `Inactivo ${RUN}` });
      const soldOut = await db.mkAccessory({ priceCents: 1000, stockQty: 2 });
      await h.prisma.accessory.update({ where: { id: soldOut.id }, data: { reservedQty: 2 } });
      const short = await db.mkAccessory({ priceCents: 1000, stockQty: 3 });
      const ghost = '00000000-0000-4000-8000-00000000abcd';
      const q = await db.quote({
        accessoryLines: [
          { accessoryId: ghost, quantity: 1 },
          { accessoryId: inactive.id, quantity: 1 },
          { accessoryId: soldOut.id, quantity: 1 },
          { accessoryId: short.id, quantity: 5 },
        ],
      });
      expect(q.status).toBe(200);
      expect(q.body.unavailableAccessories).toEqual([
        { accessoryId: ghost, name: null, reason: 'not_found' },
        { accessoryId: inactive.id, name: `Inactivo ${RUN}`, reason: 'inactive' },
        { accessoryId: soldOut.id, name: soldOut.name, reason: 'sold_out' },
        { accessoryId: short.id, name: short.name, reason: 'insufficient', availableQty: 3 },
      ]);
      expect(q.body.accessoryLines).toEqual([expect.objectContaining({ accessoryId: short.id, quantity: 3, lineTotalCents: 3000 })]);
      expect(q.body.breakdown.subtotalCents).toBe(3000);
      const s = JSON.stringify(q.body);
      for (const k of ['unitCostCents', 'stockQty', 'reservedQty', 'suggested', 'lengthMm', 'widthMm', 'heightMm', 'weightG']) expect(s).not.toContain(`"${k}"`);
      await h.prisma.accessory.update({ where: { id: soldOut.id }, data: { reservedQty: 0 } });
    });

    it('session estricta: inexistente o inactivo ⇒ 409 ACCESSORY_UNAVAILABLE {accessoryId, reason}; nada creado', async () => {
      const inactive = await db.mkAccessory({ priceCents: 1000, stockQty: 5, active: false });
      const card = await db.mkItem();
      const before = await h.prisma.order.count();
      const r1 = await db.session({ inventoryItemIds: [card.id], accessoryLines: [{ accessoryId: inactive.id, quantity: 1 }] });
      expect(code(r1)).toBe('409:ACCESSORY_UNAVAILABLE');
      expect(r1.body.error.details).toEqual({ accessoryId: inactive.id, reason: 'inactive' });
      const ghost = '00000000-0000-4000-8000-00000000abce';
      const r2 = await db.session({ inventoryItemIds: [card.id], accessoryLines: [{ accessoryId: ghost, quantity: 1 }] });
      expect(code(r2)).toBe('409:ACCESSORY_UNAVAILABLE');
      expect(r2.body.error.details).toEqual({ accessoryId: ghost, reason: 'not_found' });
      expect(await h.prisma.order.count()).toBe(before);
      expect((await db.h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: card.id } })).status).toBe('listed');
    });

    it('session: más de lo disponible ⇒ 409 ACCESSORY_INSUFFICIENT_STOCK {accessoryId, availableQty}; la carta NO queda apartada', async () => {
      const a = await db.mkAccessory({ priceCents: 1000, stockQty: 2 });
      const card = await db.mkItem();
      const before = await h.prisma.order.count();
      const r = await db.session({ inventoryItemIds: [card.id], accessoryLines: [{ accessoryId: a.id, quantity: 3 }] });
      expect(code(r)).toBe('409:ACCESSORY_INSUFFICIENT_STOCK');
      expect(r.body.error.details).toEqual({ accessoryId: a.id, availableQty: 2 });
      expect(await h.prisma.order.count()).toBe(before);
      expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: card.id } })).status).toBe('listed');
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 2, reservedQty: 0 });
    });
  });

  // ================================================================ AC-B13 carrera

  describe('AC-B13 💰 carrera de la última unidad (criterio 710)', () => {
    it(`stockQty=1, dos sesiones simultáneas ⇒ una 201 y una 409 ACCESSORY_INSUFFICIENT_STOCK; nunca dos apartados (N=${N})`, async () => {
      const outcomes: string[] = [];
      for (let i = 0; i < N; i += 1) {
        const a = await db.mkAccessory({ priceCents: 8900, stockQty: 1 });
        const [r1, r2] = await Promise.all([
          db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 1 }] }),
          db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 1 }] }),
        ]);
        const st = await db.stockOf(a.id);
        const lines = await h.prisma.orderAccessoryLine.count({ where: { accessoryId: a.id, status: 'reserved' } });
        const codes = [code(r1), code(r2)].sort();
        outcomes.push(`${codes.join(',')} reserved=${st.reservedQty} lines=${lines}`);
        const winner = [r1, r2].find((r) => r.status === 201);
        if (winner) await db.failPayment(winner.body.stripe.paymentIntentId);
      }
      const ok = report('AC-B13', outcomes, (o) => o.startsWith('201:,409:ACCESSORY_INSUFFICIENT_STOCK reserved=1 lines=1'));
      expect(ok).toBe(N);
    });
  });

  // ================================================================ AC-B14 soltar

  describe('AC-B14 soltar el apartado (criterio 711)', () => {
    it('payment_failed ⇒ reservedQty vuelve; renglones `released`', async () => {
      const a = await db.mkAccessory({ priceCents: 1000, stockQty: 5 });
      const s = await db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 2 }] });
      expect(s.status).toBe(201);
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 5, reservedQty: 2 });
      await db.failPayment(s.body.stripe.paymentIntentId);
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 5, reservedQty: 0 });
      const lines = await h.prisma.orderAccessoryLine.findMany({ where: { orderId: s.body.orderId } });
      expect(lines.map((l) => l.status)).toEqual(['released']);
    });

    it('vencimiento de un pedido SOLO de accesorios ⇒ el barrido lo suelta (PI cancelado antes) y la orden queda failed', async () => {
      const a = await db.mkAccessory({ priceCents: 1000, stockQty: 5 });
      const s = await db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 3 }] });
      await h.prisma.orderAccessoryLine.updateMany({ where: { orderId: s.body.orderId }, data: { reservedUntil: new Date(Date.now() - 60_000) } });
      const canceledBefore = h.stripe.canceledIntents.length;
      await h.app.get(OrdersService).sweepExpiredReservations();
      expect(h.stripe.canceledIntents.slice(canceledBefore)).toContain(s.body.stripe.paymentIntentId);
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 5, reservedQty: 0 });
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: s.body.orderId } })).status).toBe('failed');
    });

    it('vencido pero el PI NO se puede cancelar ⇒ ⛔ no se suelta', async () => {
      const a = await db.mkAccessory({ priceCents: 1000, stockQty: 5 });
      const s = await db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 1 }] });
      await h.prisma.orderAccessoryLine.updateMany({ where: { orderId: s.body.orderId }, data: { reservedUntil: new Date(Date.now() - 60_000) } });
      h.stripe.cancelOutcome = 'throws-succeeded';
      try {
        await h.app.get(OrdersService).sweepExpiredReservations();
      } finally {
        h.stripe.cancelOutcome = 'canceled';
      }
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 5, reservedQty: 1 });
      await db.failPayment(s.body.stripe.paymentIntentId);
    });

    it('reembolso total de un pedido NUNCA liquidado (charge.refunded) ⇒ el apartado vuelve', async () => {
      const a = await db.mkAccessory({ priceCents: 1000, stockQty: 5 });
      const s = await db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 2 }] });
      const total = s.body.breakdown.totalCents;
      const r = await h.sendStripeWebhook({
        type: 'charge.refunded',
        data: { object: { id: `ch_${RUN}_${Date.now()}`, object: 'charge', payment_intent: s.body.stripe.paymentIntentId, amount: total, amount_refunded: total } },
      });
      expect(r.status).toBe(200);
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 5, reservedQty: 0 });
    });

    it('dos soltadas del mismo pedido ⇒ una sola resta (el WHERE status=reserved)', async () => {
      const a = await db.mkAccessory({ priceCents: 1000, stockQty: 5 });
      const b = await db.mkAccessory({ priceCents: 1000, stockQty: 5 });
      const s1 = await db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 2 }] });
      await db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 1 }, { accessoryId: b.id, quantity: 1 }] });
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 5, reservedQty: 3 });
      const first = await h.prisma.$transaction((tx) => releaseAccessoryReservations(tx, s1.body.orderId));
      const second = await h.prisma.$transaction((tx) => releaseAccessoryReservations(tx, s1.body.orderId));
      expect(first).toEqual({ lines: 1, units: 2 });
      expect(second).toEqual({ lines: 0, units: 0 });
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 5, reservedQty: 1 });
      expect(await db.stockOf(b.id)).toEqual({ stockQty: 5, reservedQty: 1 });
    });
  });

  // ================================================================ AC-B38 reuso

  describe('AC-B38 reintento (retryOfCheckoutToken, §4-R.3)', () => {
    it('mismo carrito ⇒ reuso (200, misma orden, apartado intacto); carrito de accesorios distinto ⇒ sustitución y el apartado viejo se suelta', async () => {
      const a = await db.mkAccessory({ priceCents: 1000, stockQty: 5 });
      const email = db.email('-retry');
      const s1 = await db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 2 }] }, { email });
      expect(s1.status).toBe(201);
      const same = await db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 2 }], retryOfCheckoutToken: s1.body.checkoutToken }, { email });
      expect(same.status).toBe(200);
      expect(same.body.reused).toBe(true);
      expect(same.body.orderId).toBe(s1.body.orderId);
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 5, reservedQty: 2 });

      const other = await db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 3 }], retryOfCheckoutToken: s1.body.checkoutToken }, { email });
      expect(other.status).toBe(201);
      expect(other.body.supersededOrderIds).toEqual([s1.body.orderId]);
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 5, reservedQty: 3 });
      const old = await h.prisma.orderAccessoryLine.findMany({ where: { orderId: s1.body.orderId } });
      expect(old.map((l) => l.status)).toEqual(['released']);
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: s1.body.orderId } })).status).toBe('failed');
    });

    it('quote con el token propio: lo apartado por la propia reserva cuenta como disponible', async () => {
      const a = await db.mkAccessory({ priceCents: 1000, stockQty: 2 });
      const email = db.email('-own');
      const s1 = await db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 2 }] }, { email });
      const ajena = await db.quote({ accessoryLines: [{ accessoryId: a.id, quantity: 2 }] });
      expect(ajena.body.unavailableAccessories).toEqual([{ accessoryId: a.id, name: a.name, reason: 'sold_out' }]);
      const propia = await db.quote({ accessoryLines: [{ accessoryId: a.id, quantity: 2 }], retryOfCheckoutToken: s1.body.checkoutToken, email });
      expect(propia.body.unavailableAccessories).toEqual([]);
      expect(propia.body.accessoryLines[0].quantity).toBe(2);
    });
  });

  // ================================================================ AC-B15 liquidar

  describe('AC-B15 liquidar (criterio 712)', () => {
    it('20 − 3 ⇒ 17, reservedQty 0, movimiento `sale`, renglón sold, ShipmentAccessoryLine en el envío que nace', async () => {
      const a = await db.mkAccessory({ priceCents: 8900, stockQty: 20 });
      const card = await db.mkItem();
      const p = await db.paidOrder({ inventoryItemIds: [card.id], accessoryLines: [{ accessoryId: a.id, quantity: 3 }] });
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 17, reservedQty: 0 });
      const mv = await h.prisma.accessoryStockMovement.findMany({ where: { accessoryId: a.id } });
      expect(mv.map((m) => ({ kind: m.kind, delta: m.delta, before: m.stockBefore, after: m.stockAfter, order: m.orderId, actor: m.actorUserId }))).toEqual([
        { kind: 'sale', delta: -3, before: 20, after: 17, order: p.orderId, actor: null },
      ]);
      const line = await h.prisma.orderAccessoryLine.findFirstOrThrow({ where: { orderId: p.orderId } });
      expect(line.status).toBe('sold');
      expect(line.soldAt).not.toBeNull();
      expect(line.settledWithoutStock).toBe(false);
      const sal = await h.prisma.shipmentAccessoryLine.findMany({ where: { orderAccessoryLineId: line.id } });
      expect(sal).toHaveLength(1);
      expect(sal[0]).toMatchObject({ shipmentRequestId: p.shipmentId, quantity: 3, prepStatus: 'pending', missingQty: 0 });
      // Reentrega del webhook: idempotente (no vuelve a bajar).
      await db.settle(p.s);
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 17, reservedQty: 0 });
    });

    it('pago tardío tras el barrido CON existencias ⇒ settle_recovery; SIN existencias ⇒ settledWithoutStock + bitácora', async () => {
      const a = await db.mkAccessory({ priceCents: 1000, stockQty: 5 });
      const late = await db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 3 }] });
      await h.prisma.orderAccessoryLine.updateMany({ where: { orderId: late.body.orderId }, data: { reservedUntil: new Date(Date.now() - 60_000) } });
      await h.app.get(OrdersService).sweepExpiredReservations();
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 5, reservedQty: 0 });
      await db.settle(late);
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 2, reservedQty: 0 });
      const l1 = await h.prisma.orderAccessoryLine.findFirstOrThrow({ where: { orderId: late.body.orderId } });
      expect(l1).toMatchObject({ status: 'sold', settledWithoutStock: false });
      expect((await h.prisma.accessoryStockMovement.findFirstOrThrow({ where: { accessoryId: a.id, orderId: late.body.orderId } })).kind).toBe('settle_recovery');

      // Sin existencias: otro cliente aparta las 2 que quedan; el pago tardío no tiene de dónde.
      const late2 = await db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 1 }] });
      await h.prisma.orderAccessoryLine.updateMany({ where: { orderId: late2.body.orderId }, data: { reservedUntil: new Date(Date.now() - 60_000) } });
      await h.app.get(OrdersService).sweepExpiredReservations();
      const other = await db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 2 }] });
      expect(other.status).toBe(201);
      await db.settle(late2);
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 2, reservedQty: 2 });
      const l2 = await h.prisma.orderAccessoryLine.findFirstOrThrow({ where: { orderId: late2.body.orderId } });
      expect(l2).toMatchObject({ status: 'sold', settledWithoutStock: true });
      const audit = await h.prisma.auditLog.findMany({ where: { entityId: late2.body.orderId, action: 'order.settle_accessory_unbacked' } });
      expect(audit).toHaveLength(1);
      expect(audit[0].after).toEqual({ lineId: l2.id, accessoryId: a.id, quantity: 1 });
    });
  });

  // ================================================================ AC-B16 / 749

  describe('AC-B16 sin bóveda y con sesión se rechaza (criterios 713, 742, 749)', () => {
    it('con cuenta: quote y session con accesorios o paquete ⇒ 422 ACCESSORIES_REQUIRE_DIRECT_SHIP; nada apartado, sin PI', async () => {
      const a = await db.mkAccessory({ priceCents: 1000, stockQty: 5 });
      const card = await db.mkItem();
      const pis = h.stripe.createdIntents.length;
      const orders = await h.prisma.order.count();
      const q = await h.api('POST', '/checkout/quote', { token: db.customerToken, json: { inventoryItemIds: [card.id], accessoryLines: [{ accessoryId: a.id, quantity: 1 }] } });
      expect(code(q)).toBe('422:ACCESSORIES_REQUIRE_DIRECT_SHIP');
      const s = await h.api('POST', '/checkout/session', { token: db.customerToken, json: { inventoryItemIds: [card.id], accessoryLines: [{ accessoryId: a.id, quantity: 1 }] } });
      expect(code(s)).toBe('422:ACCESSORIES_REQUIRE_DIRECT_SHIP');
      const s2 = await h.api('POST', '/checkout/session', { token: db.customerToken, json: { inventoryItemIds: [card.id], deckPulls: [{ pullToken: 'x.y', withEnergyBundle: true }] } });
      expect(code(s2)).toBe('422:ACCESSORIES_REQUIRE_DIRECT_SHIP');
      expect(h.stripe.createdIntents.length).toBe(pis);
      expect(await h.prisma.order.count()).toBe(orders);
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 5, reservedQty: 0 });
      expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: card.id } })).status).toBe('listed');
    });

    it('con sesión por la ruta de INVITADO ⇒ 409 ALREADY_AUTHENTICATED (guarda), nada apartado', async () => {
      const a = await db.mkAccessory({ priceCents: 1000, stockQty: 5 });
      const r = await db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 1 }] }, { token: db.customerToken });
      expect(code(r)).toBe('409:ALREADY_AUTHENTICATED');
      const q = await db.quote({ accessoryLines: [{ accessoryId: a.id, quantity: 1 }] }, db.customerToken);
      expect(code(q)).toBe('409:ALREADY_AUTHENTICATED');
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 5, reservedQty: 0 });
    });

    it('invitado con fulfillmentMode vault ⇒ 422 VAULT_REQUIRES_ACCOUNT antes de todo; ningún VaultPlacementItem', async () => {
      const a = await db.mkAccessory({ priceCents: 1000, stockQty: 5 });
      const r = await db.session({ accessoryLines: [{ accessoryId: a.id, quantity: 1 }], fulfillmentMode: 'vault' });
      expect(code(r)).toBe('422:VAULT_REQUIRES_ACCOUNT');
      expect(await db.stockOf(a.id)).toEqual({ stockQty: 5, reservedQty: 0 });
    });
  });

  // ================================================================ AC-B24 / B25 / B45 / B46 la caja

  describe('AC-B24 💰 la caja decide el envío (criterios 725–728)', () => {
    it('sin cajas con tarifa ⇒ la tarifa de hoy exacta, con o sin accesorios (725 (a))', async () => {
      const funda = await db.mkAccessory({ priceCents: 8900, stockQty: 10, dims: FUNDA_DIMS });
      const q = await db.quote({ accessoryLines: [{ accessoryId: funda.id, quantity: 1 }] });
      expect(q.body.breakdown.shippingFeeCents).toBe(db.eBase);
      expect(q.body.shippingBox).toBeNull();
    });

    it('chica (< hoy) y grande (> hoy): cartas + funda ⇒ tarifa de hoy (max); playmat ⇒ grande; quitar el playmat ⇒ vuelve (725 (c), 726, 727)', async () => {
      const funda = await db.mkAccessory({ priceCents: 8900, stockQty: 10, dims: FUNDA_DIMS });
      const playmat = await db.mkAccessory({ priceCents: 45000, stockQty: 10, dims: PLAYMAT_DIMS, category: 'playmats' });
      const card = await db.mkItem();
      await db.setBoxes([
        { code: 'chica', l: 25, w: 20, h: 10, fee: db.eBase - 5000, sortOrder: 1 },
        { code: 'grande', l: 70, w: 40, h: 10, fee: db.eBase + 9700, sortOrder: 2 },
      ]);
      const q1 = await db.quote({ inventoryItemIds: [card.id], accessoryLines: [{ accessoryId: funda.id, quantity: 1 }] });
      expect(q1.body.shippingBox).toEqual({ code: `chica-${RUN}`, label: 'CHICA', review: false });
      expect(q1.body.breakdown.shippingFeeCents).toBe(db.eBase);
      const q2 = await db.quote({ inventoryItemIds: [card.id], accessoryLines: [{ accessoryId: funda.id, quantity: 1 }, { accessoryId: playmat.id, quantity: 1 }] });
      expect(q2.body.shippingBox).toEqual({ code: `grande-${RUN}`, label: 'GRANDE', review: false });
      expect(q2.body.breakdown.shippingFeeCents).toBe(db.eBase + 9700);
      const itemPrice = q2.body.items[0].unitPriceCents;
      expect(q2.body.breakdown).toEqual(bd(itemPrice + 8900 + 45000, db.eBase + 9700));
      const s = await db.session({ inventoryItemIds: [card.id], accessoryLines: [{ accessoryId: funda.id, quantity: 1 }, { accessoryId: playmat.id, quantity: 1 }] });
      expect(s.status).toBe(201);
      expect(s.body.breakdown).toEqual(q2.body.breakdown);
      expect(s.body.shippingBox).toEqual({ code: `grande-${RUN}`, label: 'GRANDE', review: false });
      const o = await h.prisma.order.findUniqueOrThrow({ where: { id: s.body.orderId } });
      // AC-B25: la caja congelada.
      expect(o.shippingBoxSnapshot).toEqual({
        code: `grande-${RUN}`,
        label: 'GRANDE',
        lengthCm: 70,
        widthCm: 40,
        heightCm: 10,
        customerFeeCents: db.eBase + 9700,
        baseFeeCents: db.eBase,
        contentWeightG: FUNDA_DIMS.weightG + PLAYMAT_DIMS.weightG,
      });
      expect(o.shippingBoxReview).toBe(false);
      expect(o.shippingFeeCents).toBe(db.eBase + 9700);
      const back = await db.quote({ inventoryItemIds: [card.id], accessoryLines: [{ accessoryId: funda.id, quantity: 1 }] });
      expect(back.body.breakdown.shippingFeeCents).toBe(db.eBase);
    });

    it('I-AC-5: pedido solo de cartas (o de energías) con cajas registradas ⇒ hoy exacto y sin caja (725 (b))', async () => {
      await db.setBoxes([{ code: 'grande', l: 70, w: 40, h: 10, fee: db.eBase + 9700 }]);
      const card = await db.mkItem();
      const q = await db.quote({ inventoryItemIds: [card.id] });
      expect(q.body.shippingBox).toBeNull();
      expect(q.body.breakdown).toEqual(bd(q.body.items[0].unitPriceCents, db.eBase));
      expect(q.body.vaultExcludesAccessories).toBe(false);
      const fire = await db.setEnergy('fire', { stockQty: 20, dims: PLAYMAT_DIMS });
      const qe = await db.quote({ accessoryLines: [{ accessoryId: fire, quantity: 8 }] });
      expect(qe.body.shippingBox).toBeNull();
      expect(qe.body.breakdown.shippingFeeCents).toBe(db.eBase);
      const s = await db.session({ inventoryItemIds: [card.id] });
      const o = await h.prisma.order.findUniqueOrThrow({ where: { id: s.body.orderId } });
      expect(o.shippingBoxSnapshot).toBeNull();
      expect(o.shippingBoxReview).toBe(false);
    });

    it('AC-B45: energía CON medidas en el carrito ⇒ misma caja, tarifa y contentWeightG que sin ella', async () => {
      const funda = await db.mkAccessory({ priceCents: 8900, stockQty: 10, dims: FUNDA_DIMS });
      const fire = await db.setEnergy('fire', { stockQty: 20, dims: HUGE_DIMS });
      await db.setBoxes([
        { code: 'chica', l: 25, w: 20, h: 10, fee: db.eBase + 100, sortOrder: 1 },
        { code: 'grande', l: 70, w: 40, h: 10, fee: db.eBase + 9700, sortOrder: 2 },
      ]);
      const without = await db.session({ accessoryLines: [{ accessoryId: funda.id, quantity: 1 }] });
      const withE = await db.session({ accessoryLines: [{ accessoryId: funda.id, quantity: 1 }, { accessoryId: fire, quantity: 4 }] });
      expect(withE.body.shippingBox).toEqual(without.body.shippingBox);
      expect(withE.body.breakdown.shippingFeeCents).toBe(without.body.breakdown.shippingFeeCents);
      const [o1, o2] = await Promise.all([without, withE].map((s) => h.prisma.order.findUniqueOrThrow({ where: { id: s.body.orderId } })));
      expect(o2.shippingBoxSnapshot).toEqual(o1.shippingBoxSnapshot);
      expect((o2.shippingBoxSnapshot as { contentWeightG: number }).contentWeightG).toBe(FUNDA_DIMS.weightG);
    });

    it('AC-B46 / 728: 3 que no caben ⇒ la MAYOR con review; cobro = max(hoy, mayor); liquida; la hoja lo muestra; sin cargo extra', async () => {
      const big = await db.mkAccessory({ priceCents: 30000, stockQty: 5, dims: HUGE_DIMS, category: 'deck_boxes' });
      await db.setBoxes([
        { code: 'chica', l: 25, w: 20, h: 10, fee: db.eBase - 5000, sortOrder: 1 },
        { code: 'grande', l: 70, w: 40, h: 10, fee: db.eBase + 9700, sortOrder: 2 },
      ]);
      const q = await db.quote({ accessoryLines: [{ accessoryId: big.id, quantity: 3 }] });
      expect(q.body.shippingBox).toEqual({ code: `grande-${RUN}`, label: 'GRANDE', review: true });
      expect(q.body.breakdown.shippingFeeCents).toBe(db.eBase + 9700);
      const p = await db.paidOrder({ accessoryLines: [{ accessoryId: big.id, quantity: 3 }] });
      const o = await h.prisma.order.findUniqueOrThrow({ where: { id: p.orderId } });
      expect(o.status).toBe('settled');
      expect(o.shippingBoxReview).toBe(true);
      const sheet = await db.pickingList();
      const row = (sheet.body.data as any[]).find((x) => x.shipmentId === p.shipmentId);
      expect(row.box).toEqual({ code: `grande-${RUN}`, label: 'GRANDE', lengthCm: 70, widthCm: 40, heightCm: 10, review: true, contentWeightG: 3 * HUGE_DIMS.weightG });
      const det = await db.shipmentDetail(p.shipmentId);
      expect(det.body.box).toEqual(row.box);
      const pis = h.stripe.createdIntents.filter((i) => i.metadata.orderId === p.orderId).length;
      await db.shipAll(p.shipmentId, 'enviado');
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: p.orderId } })).totalCents).toBe(o.totalCents);
      expect(h.stripe.createdIntents.filter((i) => i.metadata.orderId === p.orderId).length).toBe(pis);
    });
  });

  // ================================================================ AC-B32 / B33 / B34 / B44 / B56 / B57 paquete

  describe('AC-B32 💰 paquete de energías en quote/session (criterios 736, 738)', () => {
    async function deckWorld(fireStock = 10) {
      const fire = await db.setEnergy('fire', { stockQty: fireStock, unitCostCents: 200 });
      const deck = await db.mkDeck({ cards: 2, energies: [{ rawName: 'Basic Fire Energy', quantity: 8 }] });
      const i1 = await db.mkItem();
      const i2 = await db.mkItem();
      const token = db.token(deck, [i1.id, i2.id]);
      return { fire, deck, items: [i1.id, i2.id], token };
    }

    it('válido ⇒ energyBundles con el dial (2000), looseTotal 4000, energías por tipo con la foto VIGENTE (AC-B44); session crea el renglón', async () => {
      const w = await deckWorld();
      const fireRow = await h.prisma.accessory.findUniqueOrThrow({ where: { id: w.fire } });
      const q = await db.quote({ inventoryItemIds: w.items, deckPulls: [{ pullToken: w.token, withEnergyBundle: true }] });
      expect(q.status).toBe(200);
      expect(q.body.energyBundles).toEqual([
        {
          deckSlug: w.deck.slug,
          deckName: w.deck.name,
          priceCents: 2000,
          looseTotalCents: 4000,
          energies: [{ energyType: 'fire', quantity: 8, accessoryId: w.fire, photo: photoDTO(w.fire, fireRow.photoVersion!) }],
        },
      ]);
      expect(q.body.unavailableBundles).toEqual([]);
      const items = (q.body.items as { unitPriceCents: number }[]).reduce((s, i) => s + i.unitPriceCents, 0);
      expect(q.body.breakdown).toEqual(bd(items + 2000, db.eBase));
      expect(q.body.vaultExcludesAccessories).toBe(true);

      const s = await db.session({ inventoryItemIds: w.items, deckPulls: [{ pullToken: w.token, withEnergyBundle: true }] });
      expect(s.status).toBe(201);
      expect(s.body.breakdown).toEqual(q.body.breakdown);
      expect(s.body.energyBundles).toEqual(q.body.energyBundles);
      expect(s.body).not.toHaveProperty('energyBundleOffers');
      expect(s.body).not.toHaveProperty('unavailableBundles');
      const line = await h.prisma.orderAccessoryLine.findFirstOrThrow({ where: { orderId: s.body.orderId }, include: { components: true } });
      const ois = await h.prisma.orderItem.findMany({ where: { orderId: s.body.orderId } });
      expect(line).toMatchObject({
        kind: 'energy_bundle',
        accessoryId: null,
        quantity: 1,
        unitPriceCents: 2000,
        unitCostCents: null,
        metaDeckId: w.deck.id,
        metaDeckListId: w.deck.listId,
        deckSlug: w.deck.slug,
        deckName: w.deck.name,
        status: 'reserved',
      });
      expect([...line.deckOrderItemIds].sort()).toEqual(ois.map((o) => o.id).sort());
      expect(line.components.map((c) => ({ a: c.accessoryId, t: c.energyType, q: c.quantity, cost: c.unitCostCents }))).toEqual([{ a: w.fire, t: 'fire', q: 8, cost: 200 }]);
      expect(await db.stockOf(w.fire)).toEqual({ stockQty: 10, reservedQty: 8 });
      await db.failPayment(s.body.stripe.paymentIntentId);
      expect(await db.stockOf(w.fire)).toEqual({ stockQty: 10, reservedQty: 0 });
    });

    it('withEnergyBundle:false válido ⇒ energyBundleOffers (no cobra); en session no se valida ni se crea', async () => {
      const w = await deckWorld();
      const q = await db.quote({ inventoryItemIds: w.items, deckPulls: [{ pullToken: w.token, withEnergyBundle: false }] });
      expect(q.body.energyBundles).toEqual([]);
      expect(q.body.energyBundleOffers).toHaveLength(1);
      expect(q.body.energyBundleOffers[0]).toMatchObject({ deckSlug: w.deck.slug, priceCents: 2000 });
      const items = (q.body.items as { unitPriceCents: number }[]).reduce((s, i) => s + i.unitPriceCents, 0);
      expect(q.body.breakdown.subtotalCents).toBe(items);
      expect(q.body.vaultExcludesAccessories).toBe(false);
      const s = await db.session({ inventoryItemIds: w.items, deckPulls: [{ pullToken: 'roto', withEnergyBundle: false }] });
      expect(s.status).toBe(201);
      expect(await h.prisma.orderAccessoryLine.count({ where: { orderId: s.body.orderId } })).toBe(0);
    });

    it('deck incompleto ⇒ quote: unavailableBundles deck_incomplete; session: 422 ENERGY_BUNDLE_INVALID {index, deckSlug, reason}; nada creado', async () => {
      const w = await deckWorld();
      const q = await db.quote({ inventoryItemIds: [w.items[0]], deckPulls: [{ pullToken: w.token, withEnergyBundle: true }] });
      expect(q.body.energyBundles).toEqual([]);
      expect(q.body.unavailableBundles).toEqual([{ index: 0, withEnergyBundle: true, deckSlug: w.deck.slug, reason: 'deck_incomplete' }]);
      const before = await h.prisma.order.count();
      const s = await db.session({ inventoryItemIds: [w.items[0]], deckPulls: [{ pullToken: w.token, withEnergyBundle: true }] });
      expect(code(s)).toBe('422:ENERGY_BUNDLE_INVALID');
      expect(s.body.error.details).toEqual({ index: 0, deckSlug: w.deck.slug, reason: 'deck_incomplete' });
      expect(await h.prisma.order.count()).toBe(before);
      expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: w.items[0] } })).status).toBe('listed');
    });

    it('dos paquetes del mismo deck ⇒ el segundo `duplicate` (quote) y 422 {index:1} (session)', async () => {
      const w = await deckWorld();
      const pulls = [
        { pullToken: w.token, withEnergyBundle: true },
        { pullToken: w.token, withEnergyBundle: true },
      ];
      const q = await db.quote({ inventoryItemIds: w.items, deckPulls: pulls });
      expect(q.body.energyBundles).toHaveLength(1);
      expect(q.body.unavailableBundles).toEqual([{ index: 1, withEnergyBundle: true, deckSlug: w.deck.slug, reason: 'duplicate' }]);
      const s = await db.session({ inventoryItemIds: w.items, deckPulls: pulls });
      expect(code(s)).toBe('422:ENERGY_BUNDLE_INVALID');
      expect(s.body.error.details).toEqual({ index: 1, deckSlug: w.deck.slug, reason: 'duplicate' });
    });

    it('AC-B34: el paquete cuesta el DIAL (leído en la sesión); ningún importe del cuerpo', async () => {
      const w = await deckWorld();
      await h.prisma.configSetting.upsert({ where: { key: 'energy_bundle_price_cents' }, create: { key: 'energy_bundle_price_cents', valueJson: 2500 }, update: { valueJson: 2500 } });
      try {
        const s = await db.session({ inventoryItemIds: w.items, deckPulls: [{ pullToken: w.token, withEnergyBundle: true, priceCents: 1 }] });
        expect(s.status).toBe(201);
        expect(s.body.energyBundles[0].priceCents).toBe(2500);
        const line = await h.prisma.orderAccessoryLine.findFirstOrThrow({ where: { orderId: s.body.orderId } });
        expect(line.unitPriceCents).toBe(2500);
        await db.failPayment(s.body.stripe.paymentIntentId);
      } finally {
        await h.prisma.configSetting.deleteMany({ where: { key: 'energy_bundle_price_cents' } });
      }
    });

    it('AC-B56: 10 Fuego — paquete de 8 + 3 sueltas ⇒ paquete entra y las sueltas bajan a 2 (insufficient); session ⇒ 409, cero filas', async () => {
      const w = await deckWorld(10);
      const body = { inventoryItemIds: w.items, deckPulls: [{ pullToken: w.token, withEnergyBundle: true }], accessoryLines: [{ accessoryId: w.fire, quantity: 3 }] };
      const q = await db.quote(body);
      expect(q.body.energyBundles).toHaveLength(1);
      expect(q.body.accessoryLines).toEqual([expect.objectContaining({ accessoryId: w.fire, quantity: 2, lineTotalCents: 1000 })]);
      const fireName = (await h.prisma.accessory.findUniqueOrThrow({ where: { id: w.fire } })).name;
      expect(q.body.unavailableAccessories).toEqual([{ accessoryId: w.fire, name: fireName, reason: 'insufficient', availableQty: 2 }]);
      const before = { orders: await h.prisma.order.count(), lines: await h.prisma.orderAccessoryLine.count() };
      const s = await db.session(body);
      expect(code(s)).toBe('409:ACCESSORY_INSUFFICIENT_STOCK');
      expect(s.body.error.details).toEqual({ accessoryId: w.fire, availableQty: 10 });
      expect({ orders: await h.prisma.order.count(), lines: await h.prisma.orderAccessoryLine.count() }).toEqual(before);
      expect(await db.stockOf(w.fire)).toEqual({ stockQty: 10, reservedQty: 0 });
    });

    it('AC-B56: dos paquetes de 8 (decks distintos) con 10 ⇒ entra el de menor index; el otro insufficient_stock con su index', async () => {
      const w = await deckWorld(10);
      const deck2 = await db.mkDeck({ cards: 2, energies: [{ rawName: 'Basic {R} Energy', quantity: 8 }] });
      const i3 = await db.mkItem();
      const i4 = await db.mkItem();
      const t2 = db.token(deck2, [i3.id, i4.id]);
      const q = await db.quote({
        inventoryItemIds: [...w.items, i3.id, i4.id],
        deckPulls: [
          { pullToken: w.token, withEnergyBundle: true },
          { pullToken: t2, withEnergyBundle: true },
        ],
      });
      expect(q.body.energyBundles.map((b: { deckSlug: string }) => b.deckSlug)).toEqual([w.deck.slug]);
      expect(q.body.unavailableBundles).toEqual([{ index: 1, withEnergyBundle: true, deckSlug: deck2.slug, reason: 'insufficient_stock' }]);
    });

    it('AC-B57: index y withEnergyBundle en unavailableBundles; ningún `ignored` viaja; session con dos true inválidos ⇒ 422 del primero', async () => {
      const w = await deckWorld();
      const deck2 = await db.mkDeck({ cards: 2, energies: [{ rawName: 'Basic Fire Energy', quantity: 8 }] });
      const j1 = await db.mkItem();
      const j2 = await db.mkItem();
      const t2 = db.token(deck2, [j1.id, j2.id]);
      const q = await db.quote({
        inventoryItemIds: [...w.items, j1.id],
        deckPulls: [
          { pullToken: 'roto.roto', withEnergyBundle: true },
          { pullToken: t2, withEnergyBundle: false },
          { pullToken: w.token, withEnergyBundle: true },
          { pullToken: w.token, withEnergyBundle: false },
        ],
      });
      expect(q.body.unavailableBundles).toEqual([
        { index: 0, withEnergyBundle: true, deckSlug: null, reason: 'invalid_token' },
        { index: 1, withEnergyBundle: false, deckSlug: deck2.slug, reason: 'deck_incomplete' },
      ]);
      expect(q.body.energyBundles.map((b: { deckSlug: string }) => b.deckSlug)).toEqual([w.deck.slug]);
      expect(q.body.energyBundleOffers).toEqual([]);
      expect(JSON.stringify(q.body)).not.toContain('ignored');
      const s = await db.session({
        inventoryItemIds: [...w.items, j1.id],
        deckPulls: [
          { pullToken: t2, withEnergyBundle: true },
          { pullToken: 'roto.roto', withEnergyBundle: true },
        ],
      });
      expect(code(s)).toBe('422:ENERGY_BUNDLE_INVALID');
      expect(s.body.error.details).toEqual({ index: 0, deckSlug: deck2.slug, reason: 'deck_incomplete' });
    });

    it(`AC-B33 💰 carrera del paquete: 8 Fuego, dos sesiones que piden 8 ⇒ una gana (criterio 741, N=${N})`, async () => {
      const deck = await db.mkDeck({ cards: 2, energies: [{ rawName: 'Basic Fire Energy', quantity: 8 }] });
      const outcomes: string[] = [];
      for (let i = 0; i < N; i += 1) {
        const fire = await db.setEnergy('fire', { stockQty: 8, unitCostCents: 200 });
        const a = [await db.mkItem(), await db.mkItem()].map((x) => x.id);
        const b = [await db.mkItem(), await db.mkItem()].map((x) => x.id);
        const [r1, r2] = await Promise.all([
          db.session({ inventoryItemIds: a, deckPulls: [{ pullToken: db.token(deck, a), withEnergyBundle: true }] }),
          db.session({ inventoryItemIds: b, deckPulls: [{ pullToken: db.token(deck, b), withEnergyBundle: true }] }),
        ]);
        const st = await db.stockOf(fire);
        // El perdedor recibe «ya no hay suficientes» ANTES de cobrar por una de dos vías, según el instante (medido: 1/10
        // en la 2.ª corrida): si los dos validan antes del apartado del otro ⇒ el `UPDATE … WHERE` ⇒ `409
        // ACCESSORY_INSUFFICIENT_STOCK`; si valida DESPUÉS del commit del ganador ⇒ el validador ya ve el stock corto ⇒
        // `422 ENERGY_BUNDLE_INVALID {reason:'insufficient_stock'}` (§AC.19.4 paso 3). Las dos son del contrato.
        const tag = (r: typeof r1) => (r.status === 422 ? `${code(r)}/${r.body.error.details.reason}` : code(r));
        const codes = [tag(r1), tag(r2)].sort();
        outcomes.push(`${codes.join(',')} reserved=${st.reservedQty}`);
        const winner = [r1, r2].find((r) => r.status === 201);
        if (winner) await db.failPayment(winner.body.stripe.paymentIntentId);
      }
      const ok = report('AC-B33', outcomes, (o) =>
        ['201:,409:ACCESSORY_INSUFFICIENT_STOCK reserved=8', '201:,422:ENERGY_BUNDLE_INVALID/insufficient_stock reserved=8'].includes(o),
      );
      expect(ok).toBe(N);
    });
  });
});
