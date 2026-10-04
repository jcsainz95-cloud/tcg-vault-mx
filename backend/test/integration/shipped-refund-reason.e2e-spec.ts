/**
 * shipped-refund-reason.e2e-spec.ts — 💰 v1.80.8.6 (M-62) · API_CONTRACT §M4-SHIP.18.12 · ARCHITECTURE §4.57 (w).
 * «El reembolso TOTAL y sus cartas: depende de si ya salió» (PROJECT §S.11, criterios 249–253). Cierra `SSL-R1`.
 *
 * Postgres REAL, app Nest completa por HTTP, webhook FIRMADO, doble de Stripe que CUENTA llamadas
 * (`refundCreateCalls`, `callLog`). Propiedad: backend.
 *
 *  SRF-1  ⭐ orden NUNCA liquidada (`vault` y `direct_ship`) + `charge.refunded` total ⇒ sus piezas `reserved` vuelven
 *         a la venta en la MISMA tx, con UN `refund_release` cada una; el catálogo las lista.
 *  SRF-2  reentregas ⇒ cero filas nuevas; el cuerpo único ⛔ escribe movimiento sin `count === 1`.
 *  SRF-3  la legada (`reservedByOrderId = null`) y la re-reservada por OTRA orden ⇒ intactas.
 *  SRF-4  ⭐ directo enviado/entregado + `charge.refunded` ⇒ cartas quietas, «por revisar», tablero, filtro.
 *  SRF-5  verbo `shipped-refund-reason` (súper-admin, `@MoneyOut`, 403 auditado al operador, 400/409/200).
 *  SRF-6  dos registros simultáneos con motivos distintos (N ≥ 10, forzado + suelto).
 *  SRF-7  M3 sobre directo enviado: sin motivo ⇒ 422 sin fila ni Stripe; con motivo ⇒ registra.
 *  SRF-8  M3 sobre directo en `guia`: conducta de hoy; con motivo ⇒ 409; `→enviado` después ⇒ 409, sin AV-5.
 *  SRF-9  ⭐ carrera `PATCH →enviado` vs `charge.refunded` (N ≥ 10 por orden forzado + N ≥ 10 suelta).
 *  SRF-10 carrera `PATCH →enviado` vs M3 tx1 (N ≥ 10 por orden forzado + N ≥ 10 suelta).
 *  SRF-11 carrera `charge.refunded` (pending) vs `succeeded` tardío (N ≥ 10 por orden, + la ventana del envío).
 *  SRF-12 barrido: orden `refunded` sin liquidar (estado previo al despliegue) ⇒ libera sin `closePaymentIntent`,
 *         sin `logger.error`; segunda pasada nada; carrera barrido vs webhook (N ≥ 10).
 *  SRF-13 por ausencia: contracargo, bóveda `already_withdrawn`, M3 sobre `pending`.
 *  A-1    `settledAt: string | null` en el detalle admin (siempre presente).
 *
 * Carreras: barrera de FILA (`ShipPrepDb.holdRow` + `forced`): una tirada sin entrelazado observado ⇒ `INVALIDA`
 * (⛔ no cuenta como verde). Se reporta la proporción con su N (`[SRF-RACE …] k/N`). Mutaciones: sobre COPIA del árbol
 * ENTERO (⛔ nunca aquí).
 */
import { randomUUID } from 'crypto';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { SettingKey } from '../../src/modules/settings/settings.constants';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { diferida } from './helpers/row-lock-barrier';
import * as releaseMod from '../../src/modules/payments/refunds/release-unsettled-refund';

const RUN = Date.now().toString(36);
const N = 10;

type Mode = 'vault' | 'direct_ship';

describe('💰 §M4-SHIP.18.12 — reembolso TOTAL «depende de si ya salió» (SRF-1…SRF-13)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let bandeja: MailMessage[] = [];
  let spy: jest.SpyInstance;
  let seq = 0;

  const av3 = () => bandeja.filter((m) => /Reembolso de tu pedido/.test(m.subject));
  const av5 = () => bandeja.filter((m) => /va en camino|on its way/.test(m.subject));
  const code = (r: R) => (r.status === 200 ? `200:${r.body?.outcome ?? 'ok'}` : `${r.status}:${r.body?.error?.code}`);
  const report = (id: string, outcomes: string[]) => {
    const ok = outcomes.filter((o) => o.startsWith('OK')).length;
    const inval = outcomes.filter((o) => o.startsWith('INVALIDA')).length;
    // eslint-disable-next-line no-console
    console.log(`[SRF-RACE ${id}] verdes ${ok}/${outcomes.length} · inválidas ${inval} · N=${outcomes.length} · ${outcomes.join(' | ')}`);
    return { ok, inval };
  };
  const evt = () => `evt_e2e_srf_${randomUUID().replace(/-/g, '')}`;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    db = new ShipPrepDb(h, `srf${RUN}`);
    await db.init();
    const port = h.app.get<MailPort>(MAIL_PORT);
    spy = jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      return {};
    });
    await h.prisma.configSetting.upsert({
      where: { key: SettingKey.OPERATOR_REFUND_CAP_24H_CENTS },
      create: { key: SettingKey.OPERATOR_REFUND_CAP_24H_CENTS, valueJson: 1_000_000_000 },
      update: { valueJson: 1_000_000_000 },
    });
  });

  afterAll(async () => {
    spy?.mockRestore();
    if (h) {
      await h.prisma.configSetting.update({ where: { key: SettingKey.OPERATOR_REFUND_CAP_24H_CENTS }, data: { valueJson: 500000 } });
      await h.prisma.auditLog.deleteMany({ where: { action: 'money_out.blocked', entityId: { contains: '/shipped-refund-reason' } } });
      await h.prisma.auditLog.deleteMany({ where: { action: 'money_out.blocked', entityId: { contains: `/admin/orders/` }, actorUserId: db.operatorId, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
      await db.cleanup();
      await h.close();
    }
  });

  beforeEach(() => {
    bandeja = [];
    h.stripe.refundOutcome = 'ok';
    h.stripe.refundDelayMs = 0;
    h.stripe.cancelOutcome = 'canceled';
  });

  // ------------------------------------------------------------------ fixtures

  /** Orden NUNCA liquidada (`pending`) con `n` piezas `reserved` por ella (vencida si `expired`). */
  async function mkPending(mode: Mode, n = 2, opts: { expired?: boolean; listPriceCents?: number } = {}) {
    const k = (seq += 1);
    const user = mode === 'vault' ? await db.mkUser('Cliente SRF') : null;
    const totalCents = 30000 + k;
    const pi = `pi_srf_${RUN}_${k}`;
    const order = await h.prisma.order.create({
      data: {
        userId: user?.id ?? null,
        guestEmail: user ? null : `srf.${RUN}.${k}@e2e.local`,
        orderNumber: `SRF-${RUN}-${k}`,
        fulfillmentMode: mode,
        status: 'pending',
        subtotalCents: totalCents,
        processingFeeCents: 0,
        ivaCents: 0,
        totalCents,
        priceConvention: 'IVA_INCLUSIVE',
        stripePaymentIntentId: pi,
        ...(mode === 'direct_ship'
          ? { shippingAddressSnapshot: { recipientName: 'Destinatario SRF', line1: 'Calle 1', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX', phone: '55' } }
          : {}),
      },
    });
    db.orders.push(order.id);
    h.stripe.chargedByIntent.set(pi, totalCents);
    const reservedUntil = new Date(Date.now() + (opts.expired ? -3600_000 : 3600_000));
    const pieces = [];
    for (let i = 0; i < n; i += 1) {
      const p = await db.mkPiece({
        status: 'reserved',
        ...(mode === 'vault' ? { ownerType: 'customer' as const, ownerUserId: user!.id, ownershipStatus: 'pending' as const } : {}),
        listPriceCents: opts.listPriceCents ?? 12345,
      });
      await h.prisma.inventoryItem.update({ where: { id: p.id }, data: { reservedByOrderId: order.id, reservedUntil } });
      await h.prisma.orderItem.create({ data: { orderId: order.id, inventoryItemId: p.id, cardSnapshot: {}, unitPriceCents: 1 } });
      pieces.push(p);
    }
    return { order, pieces, pi, totalCents, user };
  }

  const refundFull = (o: { pi: string; totalCents: number }) => db.chargeRefunded(o.pi, o.totalCents);
  const refundFullId = (o: { pi: string; totalCents: number }, id: string) =>
    h.sendStripeWebhook({ id, type: 'charge.refunded', data: { object: { id: `ch_${o.pi}`, object: 'charge', payment_intent: o.pi, amount: o.totalCents, amount_refunded: o.totalCents } } });
  const pay = (o: { pi: string; totalCents: number }, id = evt()) =>
    h.sendStripeWebhook({ id, type: 'payment_intent.succeeded', data: { object: { id: o.pi, object: 'payment_intent', amount: o.totalCents, amount_received: o.totalCents, currency: 'mxn' } } });

  /** Directo liquidado con el envío en `guia` (palomeado, preparado y con guía). */
  async function mkGuia() {
    const d = await db.mkDirect();
    for (const l of d.lines) expect((await db.mark(d.shipment.id, l.id, { status: 'picked' })).status).toBe(200);
    expect((await db.prepare(d.shipment.id, 0)).status).toBe(200);
    expect((await db.tracking(d.shipment.id)).status).toBe(201);
    expect((await db.shipment(d.shipment.id)).status).toBe('guia');
    return d;
  }
  /** Directo liquidado y ENVIADO (o entregado). */
  async function mkShipped(to: 'enviado' | 'entregado' = 'enviado') {
    const d = await mkGuia();
    expect((await db.status(d.shipment.id, 'enviado')).status).toBe(200);
    if (to === 'entregado') expect((await db.status(d.shipment.id, 'entregado')).status).toBe(200);
    bandeja = [];
    return d;
  }
  const piezas = (ids: string[]) =>
    h.prisma.inventoryItem.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' }, select: { id: true, status: true, reservedByOrderId: true, reservedUntil: true, ownerType: true, ownerUserId: true, ownershipStatus: true } });
  const movs = (ids: string[], reason?: 'refund_release') =>
    h.prisma.inventoryMovement.findMany({ where: { itemId: { in: ids }, ...(reason ? { reason } : {}) }, orderBy: { createdAt: 'asc' } });
  const reviews = async () => (await db.dashboard()).body.workQueue.refundReviews as { pending: number; oldestRefundedAt: string | null } | null;
  const reasonVerb = (orderId: string, json: unknown, token = db.adminToken) =>
    h.api('POST', `/admin/orders/${orderId}/shipped-refund-reason`, { token, json }) as Promise<R>;

  // ================================================================== SRF-1 / SRF-2 / SRF-3 (criterio 249)

  describe('SRF-1 ⭐ — orden NUNCA liquidada: las piezas vuelven a la venta con el reembolso total', () => {
    it.each<[Mode]>([['vault'], ['direct_ship']])('%s `pending`: refunded; piezas `listed` sin dueño; UN `refund_release` cada una; el catálogo las lista; sin needsManual ni afterShipment', async (mode) => {
      const o = await mkPending(mode, 2);
      for (const p of o.pieces) expect((await h.api('GET', `/catalog/listings/${p.id}`)).status).toBe(404);
      expect((await refundFull(o)).status).toBe(200);
      const ord = await db.order(o.order.id);
      expect(ord.status).toBe('refunded');
      expect(ord.settledAt).toBeNull();
      expect(ord.chargebackNeedsManual).toBe(false);
      expect(ord.fullRefundAfterShipment).toBe(false);
      expect(ord.shippedRefundReason).toBeNull();
      const ps = await piezas(o.pieces.map((p) => p.id));
      expect(ps.map((p) => [p.status, p.reservedByOrderId, p.reservedUntil, p.ownerType, p.ownerUserId, p.ownershipStatus])).toEqual(
        ps.map(() => ['listed', null, null, 'platform', null, null]),
      );
      const m = await movs(o.pieces.map((p) => p.id));
      expect(m.map((x) => [x.reason, x.fromStatus, x.toStatus])).toEqual(o.pieces.map(() => ['refund_release', 'reserved', 'listed']));
      expect(m.every((x) => x.actorUserId === null)).toBe(true);
      for (const p of o.pieces) expect((await h.api('GET', `/catalog/listings/${p.id}`)).status).toBe(200);
      // bitácora del cierre: `releasedItemIds`, `afterShipment:false`, `shippedReason:null`.
      const log = await db.audits(o.order.id, 'order.full_refund_closed');
      expect(log).toHaveLength(1);
      expect(log[0].after).toMatchObject({ afterShipment: false, shippedReason: null });
      expect([...((log[0].after as { releasedItemIds: string[] }).releasedItemIds)].sort()).toEqual(o.pieces.map((p) => p.id).sort());
      expect(av3()).toHaveLength(1);
      // el `succeeded` tardío sigue siendo no-op (SL-8): ni liquida ni re-aparta.
      expect((await pay(o)).status).toBe(200);
      expect((await db.order(o.order.id)).status).toBe('refunded');
      expect((await piezas(o.pieces.map((p) => p.id))).map((p) => p.status)).toEqual(['listed', 'listed']);
      expect(await h.prisma.shipmentRequest.count({ where: { orderId: o.order.id } })).toBe(0);
    });

    it('`failed` (ya liberada por failAndRelease) + `charge.refunded` ⇒ cero `refund_release` (no era suya ya)', async () => {
      const o = await mkPending('direct_ship', 1);
      expect((await h.sendStripeWebhook({ type: 'payment_intent.payment_failed', data: { object: { id: o.pi, object: 'payment_intent' } } })).status).toBe(200);
      expect((await piezas([o.pieces[0].id]))[0].status).toBe('listed');
      expect((await refundFull(o)).status).toBe(200);
      expect((await db.order(o.order.id)).status).toBe('refunded');
      expect(await movs([o.pieces[0].id], 'refund_release')).toHaveLength(0);
    });
  });

  describe('SRF-2 — reentregas ⇒ cero filas nuevas', () => {
    it('el MISMO evento ×10 y diez eventos DISTINTOS ⇒ un movimiento por pieza, una bitácora, un AV-3', async () => {
      const o = await mkPending('vault', 2);
      const id = evt();
      expect((await refundFullId(o, id)).status).toBe(200);
      const ids = o.pieces.map((p) => p.id);
      const antes = { m: (await movs(ids)).length, a: (await db.audits(o.order.id)).length, av3: av3().length };
      for (let i = 0; i < N; i += 1) expect((await refundFullId(o, id)).status).toBe(200);
      for (let i = 0; i < N; i += 1) expect((await refundFull(o)).status).toBe(200);
      expect((await movs(ids)).length).toBe(antes.m);
      expect((await db.audits(o.order.id)).length).toBe(antes.a);
      expect(av3().length).toBe(antes.av3);
      expect(antes).toEqual({ m: 2, a: 1, av3: 1 });
    });

    it('el cuerpo único ⛔ escribe movimiento si su CAS contó 0 (id ya no reservado por la orden)', async () => {
      const o = await mkPending('direct_ship', 2);
      // Una de las dos ya no es de la orden (la soltó otra ruta) aunque el llamador la pase en `lockedReservedIds`.
      await h.prisma.inventoryItem.update({ where: { id: o.pieces[1].id }, data: { status: 'listed', reservedByOrderId: null, reservedUntil: null } });
      const released = await h.prisma.$transaction((tx) =>
        releaseMod.releaseReservedOfUnsettledRefund(tx, o.order.id, 'charge_refunded', null, {
          lockedReservedIds: o.pieces.map((p) => p.id),
          orderNumber: o.order.orderNumber,
        }),
      );
      expect(released).toEqual([o.pieces[0].id]);
      expect((await movs(o.pieces.map((p) => p.id), 'refund_release')).map((m) => m.itemId)).toEqual([o.pieces[0].id]);
    });
  });

  describe('SRF-3 — legada y re-reservada por OTRA orden: ninguna se toca', () => {
    it.each<[Mode]>([['direct_ship'], ['vault']])('%s', async (mode) => {
      const a = await mkPending(mode, 1);
      const b = await mkPending(mode, 1);
      // Pieza LEGADA en las líneas de A (`reservedByOrderId=null`) y pieza en las líneas de A re-reservada por B.
      const legada = await db.mkPiece({ status: 'reserved', listPriceCents: 1 });
      await h.prisma.orderItem.create({ data: { orderId: a.order.id, inventoryItemId: legada.id, cardSnapshot: {}, unitPriceCents: 1 } });
      await h.prisma.orderItem.create({ data: { orderId: a.order.id, inventoryItemId: b.pieces[0].id, cardSnapshot: {}, unitPriceCents: 1 } });
      const antes = await piezas([legada.id, b.pieces[0].id]);
      expect((await refundFull(a)).status).toBe(200);
      expect((await db.order(a.order.id)).status).toBe('refunded');
      expect((await piezas([a.pieces[0].id]))[0].status).toBe('listed');
      expect(await piezas([legada.id, b.pieces[0].id])).toEqual(antes);
      expect(await movs([legada.id, b.pieces[0].id])).toHaveLength(0);
      expect((await db.order(b.order.id)).status).toBe('pending');
    });
  });

  // ================================================================== SRF-4 / SRF-5 / SRF-6 (criterio 250)

  describe('SRF-4 ⭐ — directo enviado/entregado + `charge.refunded` total ⇒ cartas quietas y «por revisar»', () => {
    it.each<['enviado' | 'entregado', 'shipped' | 'delivered']>([
      ['enviado', 'shipped'],
      ['entregado', 'delivered'],
    ])('envío %s ⇒ piezas %s, cero movimientos, envío intacto, afterShipment, por revisar (fila, filtro, tablero); AV-3 1; reentrega ×10 ⇒ igual', async (to, pieceStatus) => {
      const d = await mkShipped(to);
      const ids = d.pieces.map((p) => p.id);
      const movAntes = (await movs(ids)).length;
      const shAntes = await db.shipment(d.shipment.id);
      const r0 = await reviews();
      expect((await db.chargeRefunded(d.pi, d.order.totalCents)).status).toBe(200);
      const o = await db.order(d.order.id);
      expect(o.status).toBe('refunded');
      expect(o.fullRefundAfterShipment).toBe(true);
      expect(o.shippedRefundReason).toBeNull();
      expect(o.chargebackNeedsManual).toBe(false);
      expect((await piezas(ids)).map((p) => p.status)).toEqual(ids.map(() => pieceStatus));
      expect((await movs(ids)).length).toBe(movAntes);
      expect(await db.shipment(d.shipment.id)).toEqual(shAntes);
      const r1 = await reviews();
      expect(r1!.pending).toBe(r0!.pending + 1);
      expect(r1!.oldestRefundedAt).not.toBeNull();
      const list = await db.adminOrders(`?refundReview=pending&pageSize=100&q=${d.order.orderNumber}`);
      expect(list.status).toBe(200);
      expect(list.body.data.map((x: any) => [x.id, x.refundReviewPending])).toEqual([[d.order.id, true]]);
      const det = await db.adminOrder(d.order.id);
      expect(det.body.fullRefundReview).toMatchObject({ afterShipment: true, pending: true, reason: null, note: null, recordedAt: null, recordedBy: null });
      expect(det.body.shipmentShipped).toBe(true);
      expect(av3()).toHaveLength(1);
      const log = await db.audits(d.order.id, 'order.full_refund_closed');
      expect(log).toHaveLength(1);
      expect(log[0].after).toMatchObject({ afterShipment: true, shippedReason: null, releasedItemIds: [] });
      // reentrega ×10 (eventos distintos: cada uno CORRE la pasada) ⇒ nada cambia.
      for (let i = 0; i < N; i += 1) expect((await db.chargeRefunded(d.pi, d.order.totalCents)).status).toBe(200);
      const o2 = await db.order(d.order.id);
      expect([o2.fullRefundAfterShipment, o2.shippedRefundReason, o2.status]).toEqual([true, null, 'refunded']);
      expect(av3()).toHaveLength(1);
      expect((await reviews())!.pending).toBe(r1!.pending);
      expect((await movs(ids)).length).toBe(movAntes);
      expect(await db.audits(d.order.id, 'order.full_refund_closed')).toHaveLength(1);
    });
  });

  describe('SRF-5 — `POST /admin/orders/:id/shipped-refund-reason`', () => {
    it('400 sin escribir; operador 403 auditado; súper-admin 200 recorded (sin Stripe, sin cartas, sin correo); igual ⇒ already_recorded; otro ⇒ 409 ALREADY_SET; sin afterShipment ⇒ 409 NOT_APPLICABLE; 404', async () => {
      const d = await mkShipped('enviado');
      expect((await db.chargeRefunded(d.pi, d.order.totalCents)).status).toBe(200);
      const r0 = (await reviews())!.pending;
      const xmin = async () => (await h.prisma.$queryRawUnsafe<{ x: string }[]>(`SELECT xmin::text AS x FROM "Order" WHERE id = $1`, d.order.id))[0].x;
      const x0 = await xmin();
      for (const bad of [{}, { reason: '' }, { reason: 'otro' }, { reason: 'NOT_ARRIVED' }, { reason: 'not_arrived', note: 'x'.repeat(501) }, { reason: 'not_arrived', extra: 1 }, { reason: 'not_arrived', note: 5 }, []]) {
        const r = await reasonVerb(d.order.id, bad);
        expect([JSON.stringify(bad), r.status, r.body?.error?.code]).toEqual([JSON.stringify(bad), 400, 'VALIDATION_ERROR']);
      }
      const dom = await reasonVerb(d.order.id, { reason: 'otro' });
      expect(dom.body.error.details).toEqual({ field: 'reason', allowed: ['not_arrived', 'arrived_damaged'] });
      expect(await xmin()).toBe(x0);

      const auditAntes = await h.prisma.auditLog.count({ where: { action: 'money_out.blocked', actorUserId: db.operatorId } });
      const op = await reasonVerb(d.order.id, { reason: 'not_arrived' }, db.opToken);
      expect([op.status, op.body.error.code]).toEqual([403, 'MONEY_OUT_FORBIDDEN']);
      expect(await h.prisma.auditLog.count({ where: { action: 'money_out.blocked', actorUserId: db.operatorId } })).toBe(auditAntes + 1);
      expect(await xmin()).toBe(x0);

      const stripeAntes = { refunds: h.stripe.refundCreateCalls.length, log: h.stripe.callLog.length };
      const movAntes = (await movs(d.pieces.map((p) => p.id))).length;
      bandeja = [];
      const ok = await reasonVerb(d.order.id, { reason: 'not_arrived', note: '  el paquete se perdió  ' });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ orderId: d.order.id, outcome: 'recorded' });
      expect(ok.body.fullRefundReview).toMatchObject({ afterShipment: true, pending: false, reason: 'not_arrived', note: 'el paquete se perdió', recordedBy: { id: db.adminId } });
      expect(typeof ok.body.fullRefundReview.recordedAt).toBe('string');
      const o = await db.order(d.order.id);
      expect([o.shippedRefundReason, o.shippedRefundNote, o.shippedRefundReasonByUserId]).toEqual(['not_arrived', 'el paquete se perdió', db.adminId]);
      expect(o.shippedRefundReasonAt).toBeInstanceOf(Date);
      expect((await reviews())!.pending).toBe(r0 - 1);
      expect({ refunds: h.stripe.refundCreateCalls.length, log: h.stripe.callLog.length }).toEqual(stripeAntes);
      expect((await movs(d.pieces.map((p) => p.id))).length).toBe(movAntes);
      expect(bandeja).toHaveLength(0);
      const rec = await db.audits(d.order.id, 'order.shipped_refund_reason_recorded');
      expect(rec).toHaveLength(1);
      expect(rec[0]).toMatchObject({ actorUserId: db.adminId, actorRole: 'super_admin', after: { reason: 'not_arrived', note: 'el paquete se perdió' } });

      const x1 = await xmin();
      const same = await reasonVerb(d.order.id, { reason: 'not_arrived', note: 'otra nota' });
      expect([same.status, same.body.outcome]).toEqual([200, 'already_recorded']);
      expect(same.body.fullRefundReview.note).toBe('el paquete se perdió');
      const other = await reasonVerb(d.order.id, { reason: 'arrived_damaged' });
      expect([other.status, other.body.error.code]).toEqual([409, 'SHIPPED_REFUND_REASON_ALREADY_SET']);
      expect(other.body.error.details).toEqual({ reason: 'not_arrived' }); // A-2: ⛔ sin `recordedBy`
      expect(await xmin()).toBe(x1);
      expect(await db.audits(d.order.id, 'order.shipped_refund_reason_recorded')).toHaveLength(1);

      // detalle: el registro y A-1.
      const det = await db.adminOrder(d.order.id);
      expect(det.body.fullRefundReview).toEqual(ok.body.fullRefundReview);
      expect(typeof det.body.settledAt).toBe('string');
      const list = await db.adminOrders(`?pageSize=100&q=${d.order.orderNumber}`);
      expect(list.body.data[0].refundReviewPending).toBe(false);

      // sin afterShipment (liquidado, no reembolsado; y reembolsado sin salir) ⇒ 409 NOT_APPLICABLE sin escribir.
      const g = await mkGuia();
      const na = await reasonVerb(g.order.id, { reason: 'not_arrived' });
      expect([na.status, na.body.error.code, na.body.error.details]).toEqual([409, 'SHIPPED_REFUND_REASON_NOT_APPLICABLE', { afterShipment: false }]);
      expect((await db.chargeRefunded(g.pi, g.order.totalCents)).status).toBe(200);
      const na2 = await reasonVerb(g.order.id, { reason: 'arrived_damaged' });
      expect([na2.status, na2.body.error.code]).toEqual([409, 'SHIPPED_REFUND_REASON_NOT_APPLICABLE']);
      expect((await db.order(g.order.id)).shippedRefundReason).toBeNull();
      expect((await reasonVerb(randomUUID(), { reason: 'not_arrived' })).status).toBe(404);
    });

    it('el operador VE la marca, el filtro y el motivo (N-15), sin poder registrarlo', async () => {
      const d = await mkShipped('enviado');
      expect((await db.chargeRefunded(d.pi, d.order.totalCents)).status).toBe(200);
      const list = await db.adminOrders(`?refundReview=pending&pageSize=100&q=${d.order.orderNumber}`, db.opToken);
      expect(list.body.data.map((x: any) => x.refundReviewPending)).toEqual([true]);
      const det = await db.adminOrder(d.order.id, db.opToken);
      expect(det.body.fullRefundReview.pending).toBe(true);
      expect((await db.dashboard(db.opToken)).body.workQueue.refundReviews).toBeNull();
      // y el filtro: un valor fuera del dominio ⇒ 400 {field, allowed}.
      const bad = await db.adminOrders('?refundReview=done');
      expect([bad.status, bad.body.error.details]).toEqual([400, { field: 'refundReview', allowed: ['pending'] }]);
    });
  });

  describe(`SRF-6 — dos registros simultáneos con motivos distintos (N=${N} forzado + N=${N} suelto)`, () => {
    async function una(forzado: boolean): Promise<string> {
      const d = await mkShipped('enviado');
      expect((await db.chargeRefunded(d.pi, d.order.totalCents)).status).toBe(200);
      let a: R;
      let b: R;
      let inter = true;
      if (forzado) {
        const r = await db.forced(
          () => db.holdRow('Order', d.order.id),
          () => reasonVerb(d.order.id, { reason: 'not_arrived' }),
          () => reasonVerb(d.order.id, { reason: 'arrived_damaged' }),
        );
        a = r.a;
        b = r.b;
        inter = r.interleaved;
      } else {
        [a, b] = await Promise.all([reasonVerb(d.order.id, { reason: 'not_arrived' }), reasonVerb(d.order.id, { reason: 'arrived_damaged' })]);
      }
      const o = await db.order(d.order.id);
      const recs = await db.audits(d.order.id, 'order.shipped_refund_reason_recorded');
      const res = [code(a), code(b)];
      const winner = a.status === 200 && a.body.outcome === 'recorded' ? 'not_arrived' : b.status === 200 && b.body.outcome === 'recorded' ? 'arrived_damaged' : null;
      const ok =
        res.filter((x) => x === '200:recorded').length === 1 &&
        res.filter((x) => x === '409:SHIPPED_REFUND_REASON_ALREADY_SET').length === 1 &&
        o.shippedRefundReason === winner &&
        recs.length === 1;
      if (!inter) return `INVALIDA(${res.join(',')})`;
      return `${ok ? 'OK' : 'BAD'}(${res.join(',')},final=${o.shippedRefundReason},recs=${recs.length})`;
    }
    it.each<[string, boolean]>([
      ['forzado', true],
      ['suelto', false],
    ])('%s: exactamente uno `recorded`, el otro `409 …ALREADY_SET`, el motivo final es el del ganador', async (_n, forzado) => {
      const out: string[] = [];
      for (let t = 0; t < N; t += 1) out.push(await una(forzado));
      const { ok, inval } = report(`SRF-6 ${forzado ? 'forzado' : 'suelto'}`, out);
      expect(inval).toBe(0);
      expect(ok).toBe(N);
    });
  });

  // ================================================================== SRF-7 / SRF-8 (criterios 251/252)

  describe('SRF-7 — M3 sobre directo ENVIADO', () => {
    it('sin `shippedReason` ⇒ 422 sin fila ni Stripe ni bitácora; `otro` ⇒ 400; operador ⇒ 403; válido ⇒ refunded, motivo + nota + quién, no por revisar, cartas quietas, un AV-3', async () => {
      const d = await mkShipped('enviado');
      const ids = d.pieces.map((p) => p.id);
      const movAntes = (await movs(ids)).length;
      const calls0 = h.stripe.refundCreateCalls.length;
      const sin = await db.m3Refund(d.order.id, { reason: 'el cliente dice que no llegó' });
      expect([sin.status, sin.body.error.code]).toEqual([422, 'REFUND_CONFIRMATION_REQUIRED']);
      expect(sin.body.error.details).toEqual({ required: ['shipped_reason'], shipmentStatus: 'enviado' });
      expect(await db.refunds({ orderId: d.order.id })).toHaveLength(0);
      expect(h.stripe.refundCreateCalls.length).toBe(calls0);
      expect(await db.audits(d.order.id, 'order.refund')).toHaveLength(0);
      const otro = await db.m3Refund(d.order.id, { reason: 'x', shippedReason: 'otro' });
      expect([otro.status, otro.body.error.code, otro.body.error.details]).toEqual([400, 'VALIDATION_ERROR', { field: 'shippedReason', allowed: ['not_arrived', 'arrived_damaged'] }]);
      const op = await db.m3Refund(d.order.id, { reason: 'x', shippedReason: 'not_arrived' }, db.opToken);
      expect([op.status, op.body.error.code]).toEqual([403, 'MONEY_OUT_FORBIDDEN']);
      expect(await db.refunds({ orderId: d.order.id })).toHaveLength(0);
      expect(h.stripe.refundCreateCalls.length).toBe(calls0);
      expect((await db.order(d.order.id)).status).toBe('settled');

      const ok = await db.m3Refund(d.order.id, { reason: 'llegó con la carta doblada', shippedReason: 'arrived_damaged' });
      expect(ok.status).toBe(201);
      expect(h.stripe.refundCreateCalls.length).toBe(calls0 + 1);
      const o = await db.order(d.order.id);
      expect(o.status).toBe('refunded');
      expect([o.fullRefundAfterShipment, o.shippedRefundReason, o.shippedRefundNote, o.shippedRefundReasonByUserId]).toEqual([true, 'arrived_damaged', 'llegó con la carta doblada', db.adminId]);
      expect(o.shippedRefundReasonAt).toBeInstanceOf(Date);
      expect((await piezas(ids)).map((p) => p.status)).toEqual(['shipped', 'shipped']);
      expect((await movs(ids)).length).toBe(movAntes);
      expect((await db.adminOrder(d.order.id)).body.fullRefundReview).toMatchObject({ afterShipment: true, pending: false, reason: 'arrived_damaged' });
      expect(av3()).toHaveLength(1);
      const audit = await db.audits(d.order.id, 'order.refund');
      expect(audit).toHaveLength(1);
      expect(audit[0].after).toMatchObject({ shippedReason: 'arrived_damaged' });
      // y la reentrega de Stripe NO abre «por revisar» (criterio 250, ya tiene motivo).
      expect((await db.chargeRefunded(d.pi, d.order.totalCents)).status).toBe(200);
      expect((await db.order(d.order.id)).shippedRefundReason).toBe('arrived_damaged');
      expect(av3()).toHaveLength(1);
    });

    it('nota del motivo = `reason` recortado a 500', async () => {
      const d = await mkShipped('entregado');
      const r = await db.m3Refund(d.order.id, { reason: `  ${'n'.repeat(600)}  `, shippedReason: 'not_arrived' });
      expect(r.status).toBe(201);
      expect((await db.order(d.order.id)).shippedRefundNote).toBe('n'.repeat(500));
    });
  });

  describe('SRF-8 — M3 sobre directo en `guia`', () => {
    it('sin motivo ⇒ conducta de hoy (cancelado, congeladas, needsManual); con motivo ⇒ 409 NOT_APPLICABLE sin escribir; `→enviado` después ⇒ 409 sin AV-5', async () => {
      const c = await mkGuia();
      const conMotivo = await db.m3Refund(c.order.id, { reason: 'x', shippedReason: 'not_arrived' });
      expect([conMotivo.status, conMotivo.body.error.code, conMotivo.body.error.details]).toEqual([409, 'SHIPPED_REFUND_REASON_NOT_APPLICABLE', { afterShipment: false }]);
      expect(await db.refunds({ orderId: c.order.id })).toHaveLength(0);
      expect((await db.shipment(c.shipment.id)).status).toBe('guia');

      const r = await db.m3Refund(c.order.id, { reason: 'error de la plataforma' });
      expect(r.status).toBe(201);
      const sh = await db.shipment(c.shipment.id);
      expect(sh.status).toBe('cancelado');
      const o = await db.order(c.order.id);
      expect([o.status, o.chargebackNeedsManual, o.fullRefundAfterShipment, o.shippedRefundReason]).toEqual(['refunded', true, false, null]);
      expect((await piezas(c.pieces.map((p) => p.id))).map((p) => p.status)).toEqual(['picking', 'picking']);
      bandeja = [];
      const env = await db.status(c.shipment.id, 'enviado');
      expect(env.status).toBe(409);
      expect(['CONFLICT', 'ORDER_NOT_SETTLED']).toContain(env.body.error.code);
      // fijado por medición: el CAS del envío corta primero (lee `cancelado` antes de la guarda de la orden)
      expect(env.body.error.code).toBe('CONFLICT');
      expect(av5()).toHaveLength(0);
      expect((await db.order(c.order.id)).fullRefundAfterShipment).toBe(false);
    });
  });

  // ================================================================== SRF-9 / SRF-10 (criterio 252) — carreras

  /** Desenlace de una carrera `→enviado` vs reembolso total sobre un directo en `guia`. */
  async function desenlace(d: Awaited<ReturnType<typeof mkGuia>>, patch: R) {
    const sh = await db.shipment(d.shipment.id);
    const o = await db.order(d.order.id);
    const ps = (await piezas(d.pieces.map((p) => p.id))).map((p) => p.status);
    const A =
      sh.status === 'enviado' && ps.every((s) => s === 'shipped') && o.fullRefundAfterShipment && o.shippedRefundReason === null && !o.chargebackNeedsManual && o.status === 'refunded' && patch.status === 200;
    const B =
      sh.status === 'cancelado' && ps.every((s) => s === 'picking') && o.chargebackNeedsManual && !o.fullRefundAfterShipment && o.status === 'refunded' && patch.status === 409 && av5().length === 0;
    return { A, B, tag: `${sh.status},${ps.join('/')},after=${o.fullRefundAfterShipment},manual=${o.chargebackNeedsManual},${o.status},patch=${code(patch)},av5=${av5().length}` };
  }

  describe(`SRF-9 ⭐ — carrera \`PATCH →enviado\` vs \`charge.refunded\` total (N=${N} por orden forzado + N=${N} suelta)`, () => {
    async function una(orden: 'enviado-primero' | 'reembolso-primero' | 'suelta'): Promise<string> {
      const d = await mkGuia();
      bandeja = [];
      let patch: R;
      let wh: R;
      let inter = true;
      if (orden === 'suelta') {
        [patch, wh] = await Promise.all([db.status(d.shipment.id, 'enviado'), db.chargeRefunded(d.pi, d.order.totalCents)]);
      } else {
        const env = () => db.status(d.shipment.id, 'enviado');
        const ref = () => db.chargeRefunded(d.pi, d.order.totalCents);
        const r = await db.forced(() => db.holdRow('ShipmentRequest', d.shipment.id), orden === 'enviado-primero' ? env : ref, orden === 'enviado-primero' ? ref : env);
        patch = orden === 'enviado-primero' ? r.a : r.b;
        wh = orden === 'enviado-primero' ? r.b : r.a;
        inter = r.interleaved;
      }
      if (wh.status !== 200) return `BAD(webhook ${wh.status})`;
      const x = await desenlace(d, patch);
      if (!inter) return `INVALIDA(${x.tag})`;
      if (orden === 'enviado-primero' && !x.A) return `BAD(esperado A: ${x.tag})`;
      if (orden === 'reembolso-primero' && !x.B) return `BAD(esperado B: ${x.tag})`;
      return x.A !== x.B ? `OK(${x.A ? 'A' : 'B'})` : `BAD(mezcla: ${x.tag})`;
    }
    it.each<['enviado-primero' | 'reembolso-primero' | 'suelta']>([['enviado-primero'], ['reembolso-primero'], ['suelta']])('%s: exactamente UNO de los dos desenlaces completos; ⛔ nunca mezcla', async (orden) => {
      const out: string[] = [];
      for (let t = 0; t < N; t += 1) out.push(await una(orden));
      const { ok, inval } = report(`SRF-9 ${orden}`, out);
      expect(inval).toBe(0);
      expect(ok).toBe(N);
    });
  });

  describe(`SRF-10 — carrera \`PATCH →enviado\` vs M3 tx1 (N=${N} por orden forzado + N=${N} suelta)`, () => {
    async function una(orden: 'm3-primero' | 'enviado-primero' | 'suelta'): Promise<string> {
      const d = await mkGuia();
      bandeja = [];
      const calls0 = h.stripe.refundCreateCalls.length;
      let patch: R;
      let m3: R;
      let inter = true;
      const env = () => db.status(d.shipment.id, 'enviado');
      const ref = () => db.m3Refund(d.order.id, { reason: 'sin motivo de envío' });
      if (orden === 'suelta') {
        [patch, m3] = await Promise.all([env(), ref()]);
      } else {
        const r = await db.forced(() => db.holdRow('ShipmentRequest', d.shipment.id), orden === 'm3-primero' ? ref : env, orden === 'm3-primero' ? env : ref);
        m3 = orden === 'm3-primero' ? r.a : r.b;
        patch = orden === 'm3-primero' ? r.b : r.a;
        inter = r.interleaved;
      }
      const sh = await db.shipment(d.shipment.id);
      const o = await db.order(d.order.id);
      const rows = await db.refunds({ orderId: d.order.id });
      const calls = h.stripe.refundCreateCalls.length - calls0;
      const tag = `m3=${code(m3)},patch=${code(patch)},${sh.status},${o.status},rows=${rows.length},stripe=${calls}`;
      // (A) M3 primero: envío cancelado, PATCH 409, reembolsado SIN motivo y sin «por revisar».
      const A = m3.status === 201 && sh.status === 'cancelado' && patch.status === 409 && o.status === 'refunded' && !o.fullRefundAfterShipment && rows.length === 1 && calls === 1;
      // (B) enviado primero: M3 sin motivo ⇒ 422, cero filas, cero Stripe; con motivo ⇒ reembolsa y registra.
      let B = false;
      if (m3.status === 422 && m3.body.error.details?.required?.[0] === 'shipped_reason' && sh.status === 'enviado' && patch.status === 200 && rows.length === 0 && calls === 0 && o.status === 'settled') {
        const again = await db.m3Refund(d.order.id, { reason: 'no llegó', shippedReason: 'not_arrived' });
        const o2 = await db.order(d.order.id);
        B = again.status === 201 && o2.status === 'refunded' && o2.shippedRefundReason === 'not_arrived' && o2.fullRefundAfterShipment && h.stripe.refundCreateCalls.length - calls0 === 1;
      }
      // ⛔ el rojo: reembolso de un pedido enviado SIN motivo.
      const o3 = await db.order(d.order.id);
      const sinMotivo = o3.status === 'refunded' && (await db.shipment(d.shipment.id)).status === 'enviado' && o3.shippedRefundReason === null && (await db.refunds({ orderId: d.order.id })).length > 0;
      if (!inter) return `INVALIDA(${tag})`;
      if (sinMotivo) return `BAD(enviado reembolsado sin motivo: ${tag})`;
      if (orden === 'm3-primero' && !A) return `BAD(esperado A: ${tag})`;
      if (orden === 'enviado-primero' && !B) return `BAD(esperado B: ${tag})`;
      return A !== B ? `OK(${A ? 'A' : 'B'})` : `BAD(${tag})`;
    }
    it.each<['m3-primero' | 'enviado-primero' | 'suelta']>([['m3-primero'], ['enviado-primero'], ['suelta']])('%s: ⛔ nunca reembolso sin motivo de un pedido enviado', async (orden) => {
      const out: string[] = [];
      for (let t = 0; t < N; t += 1) out.push(await una(orden));
      const { ok, inval } = report(`SRF-10 ${orden}`, out);
      expect(inval).toBe(0);
      expect(ok).toBe(N);
    });
  });

  // ================================================================== SRF-11 — `charge.refunded` (pending) vs `succeeded`

  describe(`SRF-11 — \`charge.refunded\` sobre \`pending\` vs \`succeeded\` tardío (N=${N} por orden y modo)`, () => {
    /** Válido ⇔ (refunded sin liquidar, piezas `listed` con `refund_release`, sin envío vivo) o (liquidada y luego el camino liquidado). */
    async function valido(o: Awaited<ReturnType<typeof mkPending>>, mode: Mode) {
      const ord = await db.order(o.order.id);
      const ids = o.pieces.map((p) => p.id);
      const ps = await piezas(ids);
      const rr = (await movs(ids, 'refund_release')).length;
      const vivos = await h.prisma.shipmentRequest.count({ where: { orderId: o.order.id, status: { not: 'cancelado' } } });
      const listed = ps.filter((p) => p.status === 'listed').length;
      const sinLiquidar = ord.status === 'refunded' && ord.settledAt === null && listed === ids.length && rr === ids.length && vivos === 0;
      let liquidada = false;
      if (ord.status === 'refunded' && ord.settledAt !== null && rr === 0 && vivos === 0) {
        liquidada =
          mode === 'direct_ship'
            ? ps.every((p) => p.status === 'picking') && ord.chargebackNeedsManual
            : ps.every((p) => p.status === 'picking' && p.ownerType === 'platform') && ord.chargebackNeedsManual;
      }
      const tag = `${ord.status},settled=${ord.settledAt ? 'sí' : 'no'},piezas=${ps.map((p) => p.status).join('/')},rr=${rr},vivos=${vivos},manual=${ord.chargebackNeedsManual}`;
      return { ok: sinLiquidar || liquidada, tag, cual: sinLiquidar ? 'R' : 'S' };
    }

    async function carrera(mode: Mode, primero: 'pago' | 'reembolso'): Promise<string> {
      const o = await mkPending(mode, 2);
      const idPago = evt();
      const idRef = evt();
      const lanzar = (q: 'pago' | 'reembolso') => (q === 'pago' ? pay(o, idPago) : refundFullId(o, idRef));
      const segundo = primero === 'pago' ? 'reembolso' : 'pago';
      const r = await db.forced(() => db.holdRow('Order', o.order.id), () => lanzar(primero), () => lanzar(segundo));
      // Reentrega (como Stripe) de lo que no respondió 2xx (40P01/503 por el orden opuesto de candados), mismo id.
      let reintentos = 0;
      for (const [quien, res] of [[primero, r.a], [segundo, r.b]] as const) {
        if (res.status < 300) continue;
        for (let k = 0; k < 3; k += 1) {
          reintentos += 1;
          if ((await lanzar(quien)).status < 300) break;
        }
      }
      const v = await valido(o, mode);
      if (!r.interleaved) return `INVALIDA(${v.tag})`;
      return `${v.ok ? 'OK' : 'BAD'}(${v.cual},${r.a.status}/${r.b.status}${reintentos ? `+r${reintentos}` : ''}${v.ok ? '' : `,${v.tag}`})`;
    }

    it.each<[Mode, 'pago' | 'reembolso']>([
      ['direct_ship', 'reembolso'],
      ['direct_ship', 'pago'],
      ['vault', 'reembolso'],
      ['vault', 'pago'],
    ])('%s, primero el %s: o refunded + listed + refund_release, o settled y luego el camino liquidado', async (mode, primero) => {
      const out: string[] = [];
      for (let t = 0; t < N; t += 1) out.push(await carrera(mode, primero));
      const { ok, inval } = report(`SRF-11 ${mode} ${primero}-primero`, out);
      expect(inval).toBe(0);
      expect(ok).toBe(N);
    });

    it(`direct_ship — la VENTANA: el settle confirma ENTERO entre la lectura de envíos del reembolso y su candado de piezas (N=${N}) ⇒ el envío creado se cierra`, async () => {
      const out: string[] = [];
      for (let t = 0; t < N; t += 1) {
        const o = await mkPending('direct_ship', 2);
        const dentro = diferida();
        const seguir = diferida();
        let visto = false;
        const real = releaseMod.lockReservedOfOrder;
        const s = jest.spyOn(releaseMod, 'lockReservedOfOrder').mockImplementation(async (tx, orderId) => {
          if (orderId === o.order.id && !visto) {
            visto = true;
            dentro.abrir();
            await seguir.promesa;
          }
          return real(tx, orderId);
        });
        try {
          const ref = refundFull(o);
          await dentro.promesa;
          const pg = await pay(o);
          seguir.abrir();
          const rr = await ref;
          const v = await valido(o, 'direct_ship');
          out.push(`${v.ok && pg.status === 200 && rr.status === 200 ? 'OK' : 'BAD'}(${v.cual},pago=${pg.status},ref=${rr.status}${v.ok ? '' : `,${v.tag}`})`);
        } finally {
          s.mockRestore();
        }
      }
      const { ok } = report('SRF-11 ventana-envío', out);
      expect(ok).toBe(N);
    });
  });

  // ================================================================== SRF-12 — el barrido

  describe('SRF-12 — barrido: orden `refunded` NUNCA liquidada con piezas `reserved` (estado previo al despliegue)', () => {
    /** Siembra el estado PREVIO al despliegue: `refunded`, sin `settledAt`, sellada, piezas `reserved` vencidas. */
    async function previa(mode: Mode) {
      const o = await mkPending(mode, 2, { expired: true });
      await h.prisma.order.update({ where: { id: o.order.id }, data: { status: 'refunded', refundedAt: new Date(), fullRefundClosedAt: new Date() } });
      return o;
    }
    it.each<[Mode]>([['vault'], ['direct_ship']])('%s: una pasada las libera con `refund_release`; ⛔ sin cancelar el PI (Stripe real lanza); ⛔ cero logger.error; segunda pasada ⇒ nada', async (mode) => {
      const o = await previa(mode);
      const orders = h.app.get(OrdersService);
      const lg = (orders as unknown as { logger: { error: (m: string) => void; log: (m: string) => void } }).logger;
      const err = jest.spyOn(lg, 'error');
      const info = jest.spyOn(lg, 'log');
      h.stripe.cancelOutcome = 'throws-succeeded';
      try {
        await orders.sweepExpiredReservations(new Date());
        const ids = o.pieces.map((p) => p.id);
        expect((await piezas(ids)).map((p) => [p.status, p.reservedByOrderId])).toEqual([
          ['listed', null],
          ['listed', null],
        ]);
        expect((await movs(ids, 'refund_release')).map((m) => [m.fromStatus, m.toStatus, m.actorUserId])).toEqual([
          ['reserved', 'listed', null],
          ['reserved', 'listed', null],
        ]);
        expect(h.stripe.callLog.filter((c) => c === `cancel:${o.pi}`)).toHaveLength(0);
        expect(err.mock.calls.filter(([m]) => String(m).includes(o.order.orderNumber!) || String(m).includes(o.pi))).toHaveLength(0);
        expect(info.mock.calls.some(([m]) => /order-reservation-sweep\(refunded\): 2 piezas liberadas/.test(String(m)))).toBe(true);
        expect((await db.order(o.order.id)).status).toBe('refunded');
        await orders.sweepExpiredReservations(new Date());
        expect(await movs(ids, 'refund_release')).toHaveLength(2);
        expect(h.stripe.callLog.filter((c) => c === `cancel:${o.pi}`)).toHaveLength(0);
      } finally {
        err.mockRestore();
        info.mockRestore();
      }
    });

    it('una orden `refunded` que SÍ se liquidó (settledAt) ⇒ el barrido no la toca por esta rama', async () => {
      const o = await mkPending('direct_ship', 1, { expired: true });
      await h.prisma.order.update({ where: { id: o.order.id }, data: { status: 'refunded', refundedAt: new Date(), settledAt: new Date(), fullRefundClosedAt: new Date() } });
      h.stripe.cancelOutcome = 'throws-succeeded';
      await h.app.get(OrdersService).sweepExpiredReservations(new Date());
      expect((await piezas([o.pieces[0].id]))[0].status).toBe('reserved');
      expect(await movs([o.pieces[0].id], 'refund_release')).toHaveLength(0);
    });

    it(`carrera barrido vs webhook vs barrido sobre la misma orden (N=${N} forzado + N=${N} suelto) ⇒ UN movimiento por pieza, nunca dos`, async () => {
      const out: string[] = [];
      const orders = h.app.get(OrdersService);
      h.stripe.cancelOutcome = 'throws-succeeded';
      for (let t = 0; t < 2 * N; t += 1) {
        const forzado = t < N;
        const o = await previa('vault');
        const ids = o.pieces.map((p) => p.id);
        const sweep = () => orders.sweepExpiredReservations(new Date()).then(() => ({ status: 200, body: {} }) as R);
        const wh = () => refundFull(o);
        let inter = true;
        if (forzado) {
          const r = await db.forced(() => db.holdRow('InventoryItem', ids), sweep, wh);
          inter = r.interleaved;
          await sweep();
        } else {
          await Promise.all([sweep(), wh(), sweep()]);
        }
        const n = await movs(ids, 'refund_release');
        const ps = await piezas(ids);
        const ok = n.length === ids.length && new Set(n.map((m) => m.itemId)).size === ids.length && ps.every((p) => p.status === 'listed');
        out.push(!inter ? `INVALIDA(${n.length})` : `${ok ? 'OK' : 'BAD'}(${forzado ? 'f' : 's'},rr=${n.length})`);
      }
      const { ok, inval } = report('SRF-12 barrido-vs-webhook', out);
      expect(inval).toBe(0);
      expect(ok).toBe(2 * N);
    });
  });

  // ================================================================== SRF-13 — por ausencia (criterio 253)

  describe('SRF-13 — por ausencia', () => {
    it('contracargo con envío enviado ⇒ afterShipment sin tocar, nada «por revisar» (P-S11-3)', async () => {
      const d = await mkShipped('enviado');
      const r0 = (await reviews())!.pending;
      expect((await h.sendStripeWebhook({ type: 'charge.dispute.created', data: { object: { object: 'dispute', payment_intent: d.pi } } })).status).toBe(200);
      const o = await db.order(d.order.id);
      expect(o.status).toBe('chargeback');
      expect([o.fullRefundAfterShipment, o.shippedRefundReason]).toEqual([false, null]);
      expect((await reviews())!.pending).toBe(r0);
    });

    it('M3 total de bóveda con `already_withdrawn` ⇒ NO pide `shipped_reason` (P-S11-4); con motivo ⇒ 409 NOT_APPLICABLE', async () => {
      const u = await db.mkUser('Cliente SRF-13');
      const v = await db.mkVaultOrder(u.id, { placement: 'placed' });
      const w = await db.mkWithdrawal(u.id, [v.pieces[0].id], 'entregado');
      await h.prisma.inventoryItem.update({ where: { id: v.pieces[0].id }, data: { status: 'withdrawn' } });
      expect(w.shipment.status).toBe('entregado');
      const r = await db.m3Refund(v.order.id, { reason: 'x' });
      expect([r.status, r.body.error.code]).toEqual([422, 'REFUND_CONFIRMATION_REQUIRED']);
      expect(r.body.error.details.required).toEqual(['pieces_with_customer']);
      const conMotivo = await db.m3Refund(v.order.id, { reason: 'x', shippedReason: 'not_arrived', confirmPiecesWithCustomer: true });
      expect([conMotivo.status, conMotivo.body.error.code]).toEqual([409, 'SHIPPED_REFUND_REASON_NOT_APPLICABLE']);
      const ok = await db.m3Refund(v.order.id, { reason: 'x', confirmPiecesWithCustomer: true });
      expect(ok.status).toBe(201);
      const o = await db.order(v.order.id);
      expect([o.status, o.fullRefundAfterShipment, o.shippedRefundReason]).toEqual(['refunded', false, null]);
    });

    it('M3 sobre una orden `pending` ⇒ el rechazo de hoy, sin escribir', async () => {
      const o = await mkPending('direct_ship', 1);
      const r = await db.m3Refund(o.order.id, { reason: 'x', shippedReason: 'not_arrived' });
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
      expect(r.body.error.details).toEqual({ status: 'pending' });
      expect([400, 422]).toContain(r.status);
      expect((await db.order(o.order.id)).status).toBe('pending');
      expect(await db.refunds({ orderId: o.order.id })).toHaveLength(0);
    });
  });

  // ================================================================== A-1 (v1.80.8.7)

  describe('A-1 — `AdminOrderDetailDTO.settledAt: string | null` (siempre presente)', () => {
    it('nunca liquidada ⇒ `settledAt: null` presente; liquidada ⇒ string', async () => {
      const o = await mkPending('direct_ship', 1);
      expect((await refundFull(o)).status).toBe(200);
      const det = await db.adminOrder(o.order.id);
      expect(det.status).toBe(200);
      expect('settledAt' in det.body).toBe(true);
      expect(det.body.settledAt).toBeNull();
      expect(det.body.status).toBe('refunded');
      expect(det.body.fullRefundReview).toMatchObject({ afterShipment: false, pending: false });
      expect(det.body.shipmentShipped).toBe(false);
      const d = await mkGuia();
      const det2 = await db.adminOrder(d.order.id);
      expect(typeof det2.body.settledAt).toBe('string');
      expect(det2.body.fullRefundReview).toBeNull();
    });
  });
});
