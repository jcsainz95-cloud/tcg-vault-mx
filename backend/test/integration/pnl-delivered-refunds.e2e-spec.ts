/**
 * 💰 v1.82 (API_CONTRACT §PNL.2, §PNL.3, §PNL.8) — reembolsos POSTERIORES a la entrega, contra Postgres REAL.
 *
 *  - IDR-1…15: `POST /admin/orders/:id/items/:orderItemId/refund-delivered` (UNA carta de un directo `entregado`).
 *  - WDR-1…10: `POST /admin/manual-refunds/withdrawal-delivered` + preview (SPEI de UNA carta de un retiro `entregado`).
 *
 * Órdenes y envíos con las cifras del dueño (§M4-SHIP.4: `S=80000, E=15000, F=4617`, cartas 50000 y 30000) y la
 * entrega por los verbos REALES del operador (palomeo → preparado → guía → enviado → entregado). Las carreras (IDR-5,
 * WDR-6) se miden N=10 rondas y se reporta la proporción (O-3).
 */
import { ShipmentStatus } from '@prisma/client';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { SettingKey } from '../../src/modules/settings/settings.constants';
import { ManualRefundService } from '../../src/modules/payments/refunds/manual-refund.service';
import { caseRefundComponents, caseRefundContextOf } from '../../src/common/money';

const RUN = `pnl${Date.now().toString(36)}`;
const N = Number(process.env.PNL_RACE_N ?? 10);
const CLABE = '012345678901234567';

describe('§PNL.2/§PNL.3 — reembolsos tras la entrega (Postgres real)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let bandeja: MailMessage[] = [];
  let spy: jest.SpyInstance;
  const av12 = () => bandeja.filter((m) => /Reembolso de |Refund for /.test(m.subject));
  const av14 = () => bandeja.filter((m) => /Te vamos a depositar|We will deposit/.test(m.subject));
  const err = (r: R) => `${r.status}:${r.body?.error?.code ?? ''}`;
  const report = (id: string, outcomes: string[], ok: (o: string) => boolean) => {
    const k = outcomes.filter(ok).length;
    // eslint-disable-next-line no-console
    console.log(`[PNL-RACE ${id}] ${k}/${outcomes.length} · N=${outcomes.length} · ${outcomes.join(' | ')}`);
    return k;
  };
  const setK = (v: number) =>
    h.prisma.configSetting.upsert({
      where: { key: SettingKey.CASE_REFUND_HARD_MULTIPLIER },
      create: { key: SettingKey.CASE_REFUND_HARD_MULTIPLIER, valueJson: v },
      update: { valueJson: v },
    });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    db = new ShipPrepDb(h, RUN);
    await db.init();
    const port = h.app.get<MailPort>(MAIL_PORT);
    spy = jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      return {};
    });
  });

  afterAll(async () => {
    spy?.mockRestore();
    await setK(5);
    await db.cleanup();
    await h?.close();
  });

  beforeEach(async () => {
    bandeja = [];
    h.stripe.refundOutcome = 'ok';
    h.stripe.refundDelayMs = 0;
    await setK(5);
  });

  // ================================================================ fixtures

  /** Lleva un envío `picking` hasta `to` por los verbos REALES (todas sus líneas `picked`). */
  async function ship(shipmentId: string, to: ShipmentStatus = 'entregado', opts: { markAll?: boolean } = {}) {
    if (opts.markAll !== false) {
      const lines = await h.prisma.shipmentItem.findMany({ where: { shipmentRequestId: shipmentId } });
      for (const l of lines) if (l.prepStatus === 'pending') expect((await db.mark(shipmentId, l.id, { status: 'picked' })).status).toBe(200);
    }
    const prep = await db.prepare(shipmentId, 0);
    expect(prep.status).toBe(200);
    expect((await db.tracking(shipmentId)).status).toBeLessThan(300);
    expect((await db.status(shipmentId, 'enviado')).status).toBe(200);
    if (to === 'entregado') expect((await db.status(shipmentId, 'entregado')).status).toBe(200);
  }

  /** Directo liquidado (con cuenta o invitado) ENTREGADO; `oi(1)` es la carta de 30000. */
  async function deliveredDirect(opts: { guest?: boolean; to?: ShipmentStatus; priceConvention?: 'IVA_INCLUSIVE' | 'IVA_EXCLUSIVE' } = {}) {
    const u = opts.guest ? null : await db.mkUser('Directo Entregado');
    const d = await db.mkDirect({ userId: u?.id ?? null, ...(opts.priceConvention ? { priceConvention: opts.priceConvention } : {}) });
    await ship(d.shipment.id, opts.to ?? 'entregado');
    return { ...d, u, oi: (i: number) => d.orderItems[i] };
  }

  const refundDelivered = (orderId: string, orderItemId: string, json: unknown, token = db.adminToken) =>
    db.h.api('POST', `/admin/orders/${orderId}/items/${orderItemId}/refund-delivered`, { token, json });
  const body = (extra: Record<string, unknown> = {}) => ({ reason: 'arrived_damaged', note: 'llegó doblada, foto por correo 05-oct', expectedRefundCents: 31458, ...extra });

  /** Retiro de bóveda ENTREGADO de la carta de MX$500 (orden vault [50000, 30000]) con mercado `market`. */
  async function deliveredWithdrawal(
    market: number | null = 60000,
    opts: { to?: ShipmentStatus; priceConvention?: 'IVA_INCLUSIVE' | 'IVA_EXCLUSIVE' } = {},
  ) {
    const u = await db.mkUser('Retiro Entregado');
    const drawer = await db.mkDrawer();
    const card = await db.mkCard(market);
    const vo = await db.mkVaultOrder(u.id, {
      prices: [50000, 30000],
      placement: 'placed',
      locationId: drawer.id,
      cardIds: [card.id],
      ...(opts.priceConvention ? { priceConvention: opts.priceConvention } : {}),
    });
    const w = await db.mkWithdrawal(u.id, [vo.pieces[0].id], 'picking');
    await ship(w.shipment.id, opts.to ?? 'entregado');
    return { u, vo, w, line: w.lines[0], piece: vo.pieces[0] };
  }
  /** Q de la carta de MX$500 de una orden vault [50000, 30000], F=4617. */
  const Q = 50000 + Math.floor((4617 * 50000) / 80000); // 52885

  const wdr = (json: unknown, token = db.adminToken) => db.h.api('POST', '/admin/manual-refunds/withdrawal-delivered', { token, json });
  const wdrPreview = (shipmentItemId: string, amount?: number, token = db.adminToken) =>
    db.h.api('GET', `/admin/manual-refunds/withdrawal-delivered/preview?shipmentItemId=${shipmentItemId}${amount === undefined ? '' : `&amountCents=${amount}`}`, { token });
  const wBody = (shipmentItemId: string, amountCents: number, extra: Record<string, unknown> = {}) => ({
    shipmentItemId,
    reason: 'arrived_damaged',
    note: 'llegó con el borde doblado',
    amountCents,
    ...extra,
  });

  // ================================================================ PNL.2 — IDR

  describe('§PNL.2 — reembolsar UNA carta de un directo entregado', () => {
    it('IDR-1: 201; fila item_delivered 31458 (30000 + 1458, envío 0); Stripe 31458 con `item-delivered:<id>`; orden settled; cero inventario', async () => {
      const d = await deliveredDirect();
      const oi = d.oi(1);
      const pieceBefore = await db.piece(oi.inventoryItemId);
      const movesBefore = (await db.movements(d.pieces.map((p) => p.id))).length;
      const callsBefore = h.stripe.refundCreateCalls.length;
      const r = await refundDelivered(d.order.id, oi.id, body({ amountCents: 1 }));
      expect(r.status).toBe(201);
      expect(r.body.refund).toMatchObject({ kind: 'item_delivered', amountCents: 31458, deliveredReason: 'arrived_damaged', missingReason: null });
      const [row] = await db.refunds({ orderItemId: oi.id });
      const si = d.lines[1];
      expect(row).toMatchObject({
        kind: 'item_delivered',
        idempotencyKey: `item-delivered:${oi.id}`,
        orderId: d.order.id,
        orderItemId: oi.id,
        shipmentItemId: si.id,
        deliveredReason: 'arrived_damaged',
        missingReason: null,
        reason: 'llegó doblada, foto por correo 05-oct',
        amountCents: 31458,
        merchandiseCents: 30000,
        shippingCents: 0,
        shippingIvaCents: 0,
        processingFeeCents: 1458,
        compensationCents: 0,
        requestedByUserId: db.adminId,
        requestedByRole: 'super_admin',
      });
      const calls = h.stripe.refundCreateCalls.slice(callsBefore);
      expect(calls).toEqual([{ paymentIntentId: d.pi, amountCents: 31458, idempotencyKey: `item-delivered:${oi.id}` }]);
      expect((await db.order(d.order.id)).status).toBe('settled');
      expect(await db.piece(oi.inventoryItemId)).toEqual(pieceBefore);
      expect((await db.movements(d.pieces.map((p) => p.id))).length).toBe(movesBefore);
      const audit = await db.audits(d.order.id, 'order.item_refund_delivered');
      expect(audit).toHaveLength(1);
      expect(audit[0].after).toMatchObject({ orderItemId: oi.id, inventoryItemId: oi.inventoryItemId, shipmentItemId: si.id, reason: 'arrived_damaged', amountCents: 31458, refundId: row.id });
      // AV-12 con cuenta: una vez, a User.email, variante «tras la entrega».
      expect(av12()).toHaveLength(1);
      expect(av12()[0].to).toBe(d.u!.email);
      expect(av12()[0].text).toContain('Te devolvimos el dinero de una carta');
      expect(av12()[0].text).not.toMatch(/no sali/i);
    });

    it('IDR-2: vault_operator ⇒ 403 MONEY_OUT_FORBIDDEN auditado; 0 filas', async () => {
      const d = await deliveredDirect();
      const r = await refundDelivered(d.order.id, d.oi(1).id, body(), db.opToken);
      expect(err(r)).toBe('403:MONEY_OUT_FORBIDDEN');
      expect(await db.refunds({ orderId: d.order.id })).toHaveLength(0);
      const blocked = await h.prisma.auditLog.findMany({ where: { actorUserId: db.operatorId, action: 'money_out.blocked', entityId: { contains: `/items/${d.oi(1).id}/refund-delivered` } } });
      expect(blocked).toHaveLength(1);
    });

    it('IDR-3: envío en `enviado` ⇒ 409 ITEM_REFUND_NOT_AVAILABLE not_delivered; 0 filas, 0 Stripe', async () => {
      const d = await deliveredDirect({ to: 'enviado' });
      const calls = h.stripe.refundCreateCalls.length;
      const r = await refundDelivered(d.order.id, d.oi(1).id, body());
      expect(err(r)).toBe('409:ITEM_REFUND_NOT_AVAILABLE');
      expect(r.body.error.details).toEqual({ reason: 'not_delivered' });
      expect(await db.refunds({ orderId: d.order.id })).toHaveLength(0);
      expect(h.stripe.refundCreateCalls.length).toBe(calls);
    });

    it('IDR-4: segunda petición ⇒ 409 already_refunded con refundId; Stripe llamado UNA vez', async () => {
      const d = await deliveredDirect();
      const oi = d.oi(1);
      expect((await refundDelivered(d.order.id, oi.id, body())).status).toBe(201);
      const r = await refundDelivered(d.order.id, oi.id, body());
      expect(err(r)).toBe('409:ITEM_REFUND_NOT_AVAILABLE');
      const [row] = await db.refunds({ orderItemId: oi.id });
      expect(r.body.error.details).toEqual({ reason: 'already_refunded', refundId: row.id });
      expect(h.stripe.refundCreateCalls.filter((c) => c.idempotencyKey === `item-delivered:${oi.id}`)).toHaveLength(1);
    });

    it(`IDR-5 🔁: dos simultáneas sobre la misma línea ⇒ exactamente un 201 y un 409 en CADA ronda (N=${N})`, async () => {
      const outcomes: string[] = [];
      for (let i = 0; i < N; i++) {
        const d = await deliveredDirect();
        const oi = d.oi(1);
        const [a, b] = await Promise.all([refundDelivered(d.order.id, oi.id, body()), refundDelivered(d.order.id, oi.id, body())]);
        const pair = [a, b].map((x) => (x.status === 201 ? '201' : `${err(x)}/${x.body?.error?.details?.reason ?? ''}`)).sort().join('+');
        outcomes.push(pair);
        expect(await db.refunds({ orderItemId: oi.id })).toHaveLength(1);
      }
      const ok = report('IDR-5', outcomes, (o) => o === '201+409:ITEM_REFUND_NOT_AVAILABLE/already_refunded');
      expect(ok).toBe(N);
    }, 600_000);

    it('IDR-6: línea marcada faltante y reembolsada al preparar ⇒ 409 already_refunded', async () => {
      const d = await db.mkDirect({});
      expect((await db.mark(d.shipment.id, d.lines[0].id, { status: 'picked' })).status).toBe(200);
      expect((await db.mark(d.shipment.id, d.lines[1].id, { status: 'missing', missingReason: 'damaged' })).status).toBe(200);
      expect((await db.prepare(d.shipment.id, 31458)).status).toBe(200);
      expect((await db.tracking(d.shipment.id)).status).toBeLessThan(300);
      expect((await db.status(d.shipment.id, 'enviado')).status).toBe(200);
      expect((await db.status(d.shipment.id, 'entregado')).status).toBe(200);
      const r = await refundDelivered(d.order.id, d.orderItems[1].id, body());
      expect(err(r)).toBe('409:ITEM_REFUND_NOT_AVAILABLE');
      expect(r.body.error.details.reason).toBe('already_refunded');
    });

    it('IDR-7: orden vault ⇒ not_direct_ship; orden refunded ⇒ order_not_settled', async () => {
      const u = await db.mkUser('Bóveda IDR7');
      const vo = await db.mkVaultOrder(u.id, { placement: 'none' });
      const r1 = await refundDelivered(vo.order.id, vo.orderItems[1].id, body());
      expect(r1.body.error.details).toEqual({ reason: 'not_direct_ship' });
      const d = await deliveredDirect();
      await h.prisma.order.update({ where: { id: d.order.id }, data: { status: 'refunded', refundedAt: new Date() } });
      const r2 = await refundDelivered(d.order.id, d.oi(1).id, body());
      expect(r2.body.error.details).toEqual({ reason: 'order_not_settled' });
      expect(await db.refunds({ orderId: { in: [vo.order.id, d.order.id] } })).toHaveLength(0);
    });

    it('IDR-8: expectedRefundCents 31457 ⇒ 409 REFUND_PREVIEW_STALE {refundCents: 31458}; 0 filas', async () => {
      const d = await deliveredDirect();
      const r = await refundDelivered(d.order.id, d.oi(1).id, body({ expectedRefundCents: 31457 }));
      expect(err(r)).toBe('409:REFUND_PREVIEW_STALE');
      expect(r.body.error.details).toEqual({ refundCents: 31458 });
      expect(await db.refunds({ orderId: d.order.id })).toHaveLength(0);
    });

    it('IDR-9: tras IDR-1, el total de M3 reembolsa el remanente 99617 − 31458 = 68159', async () => {
      const d = await deliveredDirect();
      expect((await refundDelivered(d.order.id, d.oi(1).id, body())).status).toBe(201);
      const r = await db.m3Refund(d.order.id, { reason: 'no llegó lo demás', shippedReason: 'not_arrived' });
      expect(r.status).toBe(201);
      const full = (await db.refunds({ orderId: d.order.id, kind: 'order_full' }))[0];
      expect(full.amountCents).toBe(68159);
    });

    it('IDR-10: orden IVA_EXCLUSIVE ⇒ legacy_convention', async () => {
      const d = await deliveredDirect({ priceConvention: 'IVA_EXCLUSIVE' });
      const r = await refundDelivered(d.order.id, d.oi(1).id, body());
      expect(r.body.error.details).toEqual({ reason: 'legacy_convention' });
    });

    it('IDR-11: `:orderItemId` de OTRA orden ⇒ 404; 0 filas en las dos', async () => {
      const a = await deliveredDirect();
      const b = await deliveredDirect();
      const r = await refundDelivered(a.order.id, b.oi(1).id, body());
      expect(r.status).toBe(404);
      expect(await db.refunds({ orderId: { in: [a.order.id, b.order.id] } })).toHaveLength(0);
    });

    it('IDR-12: reason "lost" ⇒ 400 {field:reason, allowed}; nota de 2 y de 501 ⇒ 400 {field:note}', async () => {
      const d = await deliveredDirect();
      const r1 = await refundDelivered(d.order.id, d.oi(1).id, body({ reason: 'lost' }));
      expect(err(r1)).toBe('400:VALIDATION_ERROR');
      expect(r1.body.error.details).toMatchObject({ field: 'reason', allowed: ['not_arrived', 'arrived_damaged'] });
      for (const note of ['ab', 'x'.repeat(501)]) {
        const r = await refundDelivered(d.order.id, d.oi(1).id, body({ note }));
        expect(err(r)).toBe('400:VALIDATION_ERROR');
        expect(r.body.error.details.field).toBe('note');
      }
      expect(await db.refunds({ orderId: d.order.id })).toHaveLength(0);
    });

    it('IDR-13: orden de INVITADO entregada ⇒ 201; AV-12 a guestEmail UNA vez', async () => {
      const d = await deliveredDirect({ guest: true });
      const r = await refundDelivered(d.order.id, d.oi(1).id, body({ reason: 'not_arrived' }));
      expect(r.status).toBe(201);
      expect(av12()).toHaveLength(1);
      expect(av12()[0].to).toBe(d.order.guestEmail);
      expect(av12()[0].text).toContain('que no llegó');
      // sello `customerNotifiedAt` (un reintento no re-avisa)
      expect((await db.refunds({ orderId: d.order.id }))[0].customerNotifiedAt).not.toBeNull();
    });

    it('IDR-14: GET /orders/:id tras `succeeded` ⇒ items[].refund.kind = after_delivery, reason = arrived_damaged', async () => {
      h.stripe.refundOutcome = 'succeeded';
      const d = await deliveredDirect();
      expect((await refundDelivered(d.order.id, d.oi(1).id, body())).status).toBe(201);
      const token = await db.loginCustomer(d.u!.email!);
      const r = await db.clientOrder(d.order.id, token);
      expect(r.status).toBe(200);
      const item = r.body.items.find((i: any) => i.inventoryItemId === d.oi(1).inventoryItemId);
      expect(item.refund).toMatchObject({ kind: 'after_delivery', reason: 'arrived_damaged', amountCents: 31458 });
      const other = r.body.items.find((i: any) => i.inventoryItemId === d.oi(0).inventoryItemId);
      expect(other.refund).toBeNull();
    });

    it('IDR-15: GET /admin/orders/:id ⇒ deliveredRefund refundable 31458 (+ orderItemId); not_delivered en `enviado`; null tras reembolsar', async () => {
      const e = await deliveredDirect({ to: 'enviado' });
      const re = await db.adminOrder(e.order.id);
      const ie = re.body.items.find((i: any) => i.inventoryItemId === e.oi(1).inventoryItemId);
      expect(ie.deliveredRefund).toEqual({ kind: 'not_refundable', reason: 'not_delivered' });
      const d = await deliveredDirect();
      const before = await db.adminOrder(d.order.id);
      const it1 = before.body.items.find((i: any) => i.inventoryItemId === d.oi(1).inventoryItemId);
      expect(it1).toMatchObject({ orderItemId: d.oi(1).id, deliveredRefund: { kind: 'refundable', amountCents: 31458 }, refund: null });
      // la cifra de la lectura ES la que el verbo acepta
      expect((await refundDelivered(d.order.id, it1.orderItemId, body({ expectedRefundCents: it1.deliveredRefund.amountCents }))).status).toBe(201);
      const after = await db.adminOrder(d.order.id);
      const it1b = after.body.items.find((i: any) => i.inventoryItemId === d.oi(1).inventoryItemId);
      expect(it1b.deliveredRefund).toBeNull();
      expect(it1b.refund).toMatchObject({ kind: 'item_delivered', deliveredReason: 'arrived_damaged' });
      // al operador también se le envía (lectura)
      const op = await db.adminOrder(d.order.id, db.opToken);
      expect(op.body.items.find((i: any) => i.inventoryItemId === d.oi(0).inventoryItemId).deliveredRefund).toEqual({ kind: 'refundable', amountCents: 52430 }); // 50000 + floor(4617·50000/95000)
    });

    it('`GET /admin/refunds?kind=item_delivered` filtra (clase E)', async () => {
      const d = await deliveredDirect();
      expect((await refundDelivered(d.order.id, d.oi(1).id, body())).status).toBe(201);
      const r = await db.adminRefunds('?kind=item_delivered&pageSize=100');
      expect(r.status).toBe(200);
      expect(r.body.data.every((x: any) => x.kind === 'item_delivered')).toBe(true);
    });
  });

  // ================================================================ PNL.3 — WDR

  describe('§PNL.3 — retiro entregado ⇒ SPEI de UNA carta', () => {
    it('WDR-1: 201; ManualRefund withdrawal_delivered pending sin caso, componentes = caseRefundComponents(Q); 0 PaymentRefund, 0 Stripe; en la cubeta y el contador', async () => {
      const w = await deliveredWithdrawal(60000);
      const mr = h.app.get(ManualRefundService);
      const pendingBefore = (await mr.pendingSummary()).pending;
      const calls = h.stripe.refundCreateCalls.length;
      const prBefore = await h.prisma.paymentRefund.count();
      const r = await wdr(wBody(w.line.id, Q));
      expect(r.status).toBe(201);
      const dto = r.body.manualRefund;
      expect(dto).toMatchObject({
        source: 'withdrawal_delivered',
        status: 'pending',
        amountCents: Q,
        case: null,
        withdrawal: { shipmentId: w.w.shipment.id, shipmentItemId: w.line.id, reason: 'arrived_damaged', note: 'llegó con el borde doblado' },
        origin: { orderId: w.vo.order.id },
      });
      const row = await h.prisma.manualRefund.findUniqueOrThrow({ where: { id: dto.id } });
      expect(row).toMatchObject({ replacementCaseId: null, shipmentItemId: w.line.id, deliveredReason: 'arrived_damaged', customerUserId: w.u.id, idempotencyKey: `withdrawal-delivered:${dto.id}`, createdByUserId: db.adminId });
      const order = await db.order(w.vo.order.id);
      const comp = caseRefundComponents(Q, caseRefundContextOf(order, 50000));
      expect({ m: row.merchandiseCents, i: row.merchandiseIvaCents, f: row.processingFeeCents, c: row.compensationCents }).toEqual({
        m: comp.merchandiseCents,
        i: comp.merchandiseIvaCents,
        f: comp.processingFeeCents,
        c: comp.compensationCents,
      });
      expect(await h.prisma.paymentRefund.count()).toBe(prBefore);
      expect(h.stripe.refundCreateCalls.length).toBe(calls);
      const list = await db.mrList('?status=pending&pageSize=100');
      expect(list.body.data.some((x: any) => x.id === dto.id)).toBe(true);
      expect((await mr.pendingSummary()).pending).toBe(pendingBefore + 1);
      const audit = await h.prisma.auditLog.findMany({ where: { entityId: dto.id, action: 'manual_refund.withdrawal_delivered_created' } });
      expect(audit).toHaveLength(1);
      expect(audit[0].after).toMatchObject({ manualRefundId: dto.id, shipmentId: w.w.shipment.id, shipmentItemId: w.line.id, inventoryItemId: w.piece.id, amountCents: Q, referenceCents: 60000, aboveRefConfirmed: false });
      expect(av14()).toHaveLength(1);
      expect(av14()[0].text).not.toMatch(/repon/i);
      expect(av14()[0].text).toContain('de tu retiro');
    });

    it('WDR-2: 2R+1 sin confirmar ⇒ 422 CASE_REFUND_CONFIRMATION_REQUIRED; kR+1 ⇒ 422 CASE_REFUND_ABOVE_LIMIT; 0 filas', async () => {
      const w = await deliveredWithdrawal(60000); // R = 60000
      const r1 = await wdr(wBody(w.line.id, 120001));
      expect(err(r1)).toBe('422:CASE_REFUND_CONFIRMATION_REQUIRED');
      expect(r1.body.error.details).toEqual({ referenceCents: 60000, confirmAboveCents: 120000, limitCents: 300000 });
      const r2 = await wdr(wBody(w.line.id, 300001, { confirmAboveReference: true }));
      expect(err(r2)).toBe('422:CASE_REFUND_ABOVE_LIMIT');
      expect(await db.manualRows({ shipmentItemId: w.line.id })).toHaveLength(0);
      const r3 = await wdr(wBody(w.line.id, 120001, { confirmAboveReference: true }));
      expect(r3.status).toBe(201);
      const audit = await h.prisma.auditLog.findFirstOrThrow({ where: { entityId: r3.body.manualRefund.id, action: 'manual_refund.withdrawal_delivered_created' } });
      expect(audit.after).toMatchObject({ aboveRefConfirmed: true });
    });

    it('WDR-3: vault_operator ⇒ 403 MONEY_OUT_FORBIDDEN auditado (verbo y preview)', async () => {
      const w = await deliveredWithdrawal(60000);
      expect(err(await wdr(wBody(w.line.id, Q), db.opToken))).toBe('403:MONEY_OUT_FORBIDDEN');
      expect(err(await wdrPreview(w.line.id, Q, db.opToken))).toBe('403:MONEY_OUT_FORBIDDEN');
      expect(await db.manualRows({ shipmentItemId: w.line.id })).toHaveLength(0);
      const blocked = await h.prisma.auditLog.count({ where: { actorUserId: db.operatorId, action: 'money_out.blocked', entityId: { contains: 'withdrawal-delivered' } } });
      expect(blocked).toBeGreaterThanOrEqual(2);
    });

    it('WDR-4: retiro `enviado` ⇒ not_delivered; línea `missing` ⇒ not_shipped; envío directo ⇒ not_withdrawal', async () => {
      const e = await deliveredWithdrawal(60000, { to: 'enviado' });
      expect((await wdr(wBody(e.line.id, Q))).body.error.details).toEqual({ reason: 'not_delivered' });
      const m = await deliveredWithdrawal(60000);
      await h.prisma.shipmentItem.update({ where: { id: m.line.id }, data: { prepStatus: 'missing', missingReason: 'not_found', prepMarkedAt: new Date(), prepMarkedByUserId: db.operatorId } });
      expect((await wdr(wBody(m.line.id, Q))).body.error.details).toEqual({ reason: 'not_shipped' });
      const d = await deliveredDirect();
      const r = await wdr(wBody(d.lines[1].id, 1000));
      expect(err(r)).toBe('409:ITEM_REFUND_NOT_AVAILABLE');
      expect(r.body.error.details).toEqual({ reason: 'not_withdrawal' });
      expect(await db.manualRows({ shipmentItemId: { in: [e.line.id, m.line.id, d.lines[1].id] } })).toHaveLength(0);
    });

    it('WDR-5: ya hay una viva ⇒ 409 already_refunded con manualRefundId; tras cancelar ⇒ 201', async () => {
      const w = await deliveredWithdrawal(60000);
      const first = await wdr(wBody(w.line.id, Q));
      expect(first.status).toBe(201);
      const again = await wdr(wBody(w.line.id, Q));
      expect(err(again)).toBe('409:ITEM_REFUND_NOT_AVAILABLE');
      expect(again.body.error.details).toEqual({ reason: 'already_refunded', manualRefundId: first.body.manualRefund.id });
      expect((await db.mrCancel(first.body.manualRefund.id, { note: 'capturado con monto equivocado' })).status).toBe(200);
      const third = await wdr(wBody(w.line.id, Q - 100));
      expect(third.status).toBe(201);
      expect(await db.manualRows({ shipmentItemId: w.line.id, status: { not: 'cancelled' } })).toHaveLength(1);
    });

    it(`WDR-6 🔁: dos simultáneas ⇒ UNA sola viva por ronda (N=${N})`, async () => {
      const outcomes: string[] = [];
      for (let i = 0; i < N; i++) {
        const w = await deliveredWithdrawal(60000);
        const [a, b] = await Promise.all([wdr(wBody(w.line.id, Q)), wdr(wBody(w.line.id, Q))]);
        const live = await db.manualRows({ shipmentItemId: w.line.id, status: { not: 'cancelled' } });
        const pair = [a, b].map((x) => (x.status === 201 ? '201' : `${err(x)}/${x.body?.error?.details?.reason ?? ''}`)).sort().join('+');
        outcomes.push(`${pair}·vivas=${live.length}`);
      }
      const ok = report('WDR-6', outcomes, (o) => o === '201+409:ITEM_REFUND_NOT_AVAILABLE/already_refunded·vivas=1');
      expect(ok).toBe(N);
    }, 600_000);

    it('WDR-7: pagar y cancelar con los verbos de §M4-SHIP.15.13 ⇒ 200; DTO con case null y withdrawal lleno; re-emitir una cancelada', async () => {
      const w = await deliveredWithdrawal(60000);
      await db.mkKyc(w.u.id, CLABE, { legalName: 'Cliente Retiro' });
      const id = (await wdr(wBody(w.line.id, Q))).body.manualRefund.id;
      const rev = await db.mrReveal(id);
      expect(rev.status).toBe(200);
      const paid = await db.mrPaid(id, { revealToken: rev.body.revealToken, speiReference: 'ABC123' });
      expect(paid.status).toBe(200);
      expect(paid.body).toMatchObject({ outcome: 'paid', status: 'paid', case: null, withdrawal: { shipmentItemId: w.line.id } });
      const got = await db.mrGet(id);
      expect(got.body).toMatchObject({ case: null, withdrawal: { shipmentId: w.w.shipment.id, folio: w.piece.folio } });
      // cancelar + re-emitir otra
      const w2 = await deliveredWithdrawal(60000);
      const id2 = (await wdr(wBody(w2.line.id, Q))).body.manualRefund.id;
      const can = await db.mrCancel(id2, { note: 'se pagó en efectivo' });
      expect(can.status).toBe(200);
      expect(can.body).toMatchObject({ outcome: 'cancelled', case: null, withdrawal: { shipmentItemId: w2.line.id } });
      const re = await db.mrReissue(id2, { note: 'el cliente no recibió el efectivo' });
      expect(re.status).toBe(200);
      expect(re.body).toMatchObject({ source: 'withdrawal_delivered', status: 'pending', reissuedFromId: id2, withdrawal: { shipmentItemId: w2.line.id, reason: 'arrived_damaged' } });
      // la re-emitida OCUPA la línea: una nueva captura choca
      expect((await wdr(wBody(w2.line.id, Q))).body.error.details).toEqual({ reason: 'already_refunded', manualRefundId: re.body.id });
      // y la cubeta lista sin error con filas sin caso
      expect((await db.mrList('?status=cancelled&pageSize=100')).status).toBe(200);
    });

    it('WDR-8: SQL directo — withdrawal_delivered CON caso, case_excess SIN caso, withdrawal_delivered sin nota ⇒ violan CHECK', async () => {
      const w = await deliveredWithdrawal(60000);
      const id = (await wdr(wBody(w.line.id, Q))).body.manualRefund.id;
      const anyCase = await h.prisma.replacementCase.findFirst({ select: { id: true } });
      const tries: [string, RegExp][] = [
        [`UPDATE "ManualRefund" SET "replacementCaseId" = ${anyCase ? `'${anyCase.id}'` : `'x'`} WHERE id = '${id}'`, /ManualRefund_case_sources_chk/],
        [`UPDATE "ManualRefund" SET "deliveredNote" = NULL WHERE id = '${id}'`, /ManualRefund_withdrawal_delivered_chk/],
        [`UPDATE "ManualRefund" SET source = 'case_excess', "shipmentItemId" = NULL, "deliveredReason" = NULL, "deliveredNote" = NULL WHERE id = '${id}'`, /ManualRefund_case_sources_chk/],
      ];
      for (const [sql, chk] of tries) await expect(h.prisma.$executeRawUnsafe(sql)).rejects.toThrow(chk);
      // PaymentRefund: item_delivered sin motivo de entrega
      const d = await deliveredDirect();
      expect((await refundDelivered(d.order.id, d.oi(1).id, body())).status).toBe(201);
      const [pr] = await db.refunds({ orderItemId: d.oi(1).id });
      await expect(h.prisma.$executeRawUnsafe(`UPDATE "PaymentRefund" SET "deliveredReason" = NULL WHERE id = '${pr.id}'`)).rejects.toThrow(/PaymentRefund_item_delivered_chk/);
      await expect(h.prisma.$executeRawUnsafe(`UPDATE "PaymentRefund" SET "reason" = NULL WHERE id = '${pr.id}'`)).rejects.toThrow(/PaymentRefund_item_delivered_shape_chk/);
    });

    it('WDR-9: sin origen y sin mercado ⇒ 409 no_reference (verbo y preview)', async () => {
      const u = await db.mkUser('Sin origen');
      const card = await db.mkCard(null);
      const piece = await db.mkPiece({ status: 'in_custody', ownerType: 'customer', ownerUserId: u.id, ownershipStatus: 'settled', cardId: card.id });
      const w = await db.mkWithdrawal(u.id, [piece.id], 'picking');
      await ship(w.shipment.id);
      const r = await wdr(wBody(w.lines[0].id, 1000));
      expect(err(r)).toBe('409:ITEM_REFUND_NOT_AVAILABLE');
      expect(r.body.error.details).toEqual({ reason: 'no_reference' });
      expect((await wdrPreview(w.lines[0].id)).body.error.details).toEqual({ reason: 'no_reference' });
      expect(await db.manualRows({ shipmentItemId: w.lines[0].id })).toHaveLength(0);
    });

    it('WDR-9b: sin origen pero con mercado ⇒ 201 y TODO es compensación (sin IVA de venta, orderId null)', async () => {
      const u = await db.mkUser('Sin origen M');
      const card = await db.mkCard(25000);
      const piece = await db.mkPiece({ status: 'in_custody', ownerType: 'customer', ownerUserId: u.id, ownershipStatus: 'settled', cardId: card.id });
      const w = await db.mkWithdrawal(u.id, [piece.id], 'picking');
      await ship(w.shipment.id);
      const r = await wdr(wBody(w.lines[0].id, 25000));
      expect(r.status).toBe(201);
      const row = await h.prisma.manualRefund.findUniqueOrThrow({ where: { id: r.body.manualRefund.id } });
      expect(row).toMatchObject({ orderId: null, amountCents: 25000, merchandiseCents: 0, merchandiseIvaCents: 0, processingFeeCents: 0, compensationCents: 25000 });
    });

    it('WDR-10: preview sin amountCents ⇒ referencias y confirmation null; con monto ⇒ none/reinforced/blocked', async () => {
      const w = await deliveredWithdrawal(60000);
      const p = await wdrPreview(w.line.id);
      expect(p.status).toBe(200);
      expect(p.headers['cache-control']).toBe('no-store');
      expect(p.body).toEqual({ amountCents: null, paidReferenceCents: Q, market: { cents: 60000, capturedDate: expect.any(String) }, referenceCents: 60000, confirmAboveCents: 120000, limitCents: 300000, confirmation: null });
      expect((await wdrPreview(w.line.id, Q)).body.confirmation).toBe('none');
      expect((await wdrPreview(w.line.id, 120001)).body.confirmation).toBe('reinforced');
      expect((await wdrPreview(w.line.id, 300001)).body.confirmation).toBe('blocked');
      expect(err(await wdrPreview(w.line.id, 0))).toBe('400:VALIDATION_ERROR');
      expect((await db.h.api('GET', '/admin/manual-refunds/withdrawal-delivered/preview?shipmentItemId=nope', { token: db.adminToken })).status).toBe(404);
      expect(await db.manualRows({ shipmentItemId: w.line.id })).toHaveLength(0);
    });

    it('WDR-11 (§PNL.10.5 E-7): origen IVA_EXCLUSIVE y mercado M ⇒ preview paidReferenceCents null, referenceCents = M; verbo 201 con TODO compensación y orderId = origen', async () => {
      const M = 60000;
      const A = 45000;
      const w = await deliveredWithdrawal(M, { priceConvention: 'IVA_EXCLUSIVE' });
      expect((await db.order(w.vo.order.id)).priceConvention).toBe('IVA_EXCLUSIVE');
      const p = await wdrPreview(w.line.id);
      expect(p.status).toBe(200);
      expect(p.body).toMatchObject({ amountCents: null, paidReferenceCents: null, market: { cents: M }, referenceCents: M, confirmation: null });
      const r = await wdr(wBody(w.line.id, A));
      expect(r.status).toBe(201);
      expect(r.body.manualRefund).toMatchObject({ amountCents: A, origin: { orderId: w.vo.order.id } });
      const row = await h.prisma.manualRefund.findUniqueOrThrow({ where: { id: r.body.manualRefund.id } });
      // ⛔ `caseRefundComponents` partiría el IVA con la convención equivocada: todo es compensación.
      expect(row).toMatchObject({
        orderId: w.vo.order.id,
        amountCents: A,
        merchandiseCents: 0,
        merchandiseIvaCents: 0,
        processingFeeCents: 0,
        compensationCents: A,
      });
    });
  });
});
