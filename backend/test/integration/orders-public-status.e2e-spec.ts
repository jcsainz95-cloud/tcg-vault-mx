/**
 * orders-public-status.e2e-spec.ts — §M4-SHIP.16 «el cliente REGISTRADO ve su envío en el detalle del pedido» (PO-1…PO-7),
 * contra Postgres REAL. Propiedad: backend. UN cuerpo (`order-public-status.ts`) para `POST /orders/guest/track` y
 * `GET /orders/:id`; PO-3 mide la paridad. Mutaciones (cada PO nombra la suya) sobre COPIA del árbol entero.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { OWNER_EXAMPLE, ShipPrepDb } from './helpers/ship-prep-db';
import { OrderAccessTokenService } from '../../src/modules/orders/order-access-token.service';
import { MAIL_PORT, MailPort } from '../../src/modules/mail/mail.port';

const RUN = Date.now().toString(36);

describe('§M4-SHIP.16 — publicStatus y shipment del cliente registrado (Postgres real)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let spy: jest.SpyInstance;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    db = new ShipPrepDb(h, RUN);
    await db.init();
    spy = jest.spyOn(h.app.get<MailPort>(MAIL_PORT), 'send').mockImplementation(async () => ({}));
  });

  afterAll(async () => {
    spy?.mockRestore();
    await db.cleanup();
    await h?.close();
  });

  // ⭐ D2e (§19.12, PS-89): + `timeline` (siempre); `trackingUrl` solo si Skydropx la dio (guía manual aquí ⇒ ausente).
  const SHIPMENT_KEYS = ['id', 'status', 'carrier', 'trackingNumber', 'requestedAt', 'pickingAt', 'shippedAt', 'deliveredAt', 'shipTo', 'missingCount', 'timeline'].sort();

  it('PO-1 / PO-4 — directo con cuenta: tras tracking ⇒ `shipment.carrier/trackingNumber` y `publicStatus:guia`; enviado ⇒ +shippedAt; entregado ⇒ +deliveredAt; LISTA CERRADA del envío', async () => {
    const u = await db.mkUser('PO-1');
    const tok = await db.loginCustomer(u.email!);
    const d = await db.mkDirect({ userId: u.id, guestEmail: null });
    let o = await db.clientOrder(d.order.id, tok);
    expect(o.status).toBe(200);
    expect(o.body).toMatchObject({ fulfillmentMode: 'direct_ship', publicStatus: 'preparando', refundedCents: 0, shipment: { id: d.shipment.id, status: 'picking', carrier: null, trackingNumber: null, missingCount: 0 } });
    expect(Object.keys(o.body.shipment).sort()).toEqual(SHIPMENT_KEYS);
    expect(o.body.shipment.shipTo).toEqual({ recipientName: expect.any(String), city: expect.any(String), state: expect.any(String), postalCode: expect.any(String) });
    for (const l of d.lines) await db.mark(d.shipment.id, l.id, { status: 'picked' });
    expect((await db.prepare(d.shipment.id, 0)).status).toBe(200);
    const t = await db.tracking(d.shipment.id);
    expect(t.status).toBeLessThan(300);
    o = await db.clientOrder(d.order.id, tok);
    expect(o.body.publicStatus).toBe('guia');
    expect(o.body.shipment).toMatchObject({ status: 'guia', carrier: 'DHL', trackingNumber: expect.stringMatching(/^T-/) });
    expect((await db.status(d.shipment.id, 'enviado')).status).toBe(200);
    o = await db.clientOrder(d.order.id, tok);
    expect(o.body.publicStatus).toBe('enviado');
    expect(o.body.shipment.shippedAt).toEqual(expect.any(String));
    expect((await db.status(d.shipment.id, 'entregado')).status).toBe(200);
    o = await db.clientOrder(d.order.id, tok);
    expect(o.body.publicStatus).toBe('entregado');
    expect(o.body.shipment.deliveredAt).toEqual(expect.any(String));
    // PO-4: nada de costos, sellos, dirección cruda ni actores en el JSON del envío
    const json = JSON.stringify(o.body.shipment);
    for (const forbidden of ['shippingCostCents', 'trackingNoticeSentAt', 'line1', 'phone', 'preparedBy', 'stripePaymentIntentId']) expect(json).not.toContain(forbidden);
    // el título sigue trayendo `status` crudo para otras pantallas
    expect(o.body.status).toBe('settled');
    // la lista también rotula con `publicStatus`
    const list = await db.clientOrders(tok);
    expect(list.body.data.find((x: any) => x.id === d.order.id)).toMatchObject({ publicStatus: 'entregado', fulfillmentMode: 'direct_ship' });
    // Mutación: quitar `shipment` de la proyección ⇒ roja (el hallazgo); `…shipmentRow` (spread) ⇒ filtra `shippingCostCents`.
  });

  it('PO-2 / PO-5 — «no sale nada» con todo reembolsado ⇒ `reembolsado`; contracargo de un directo ⇒ `en_revision`; nunca `pagado`/`preparando` con envío cancelado; re-expedición toma el envío vivo', async () => {
    const u = await db.mkUser('PO-2');
    const tok = await db.loginCustomer(u.email!);
    const d = await db.mkDirect({ userId: u.id, guestEmail: null });
    for (const l of d.lines) await db.mark(d.shipment.id, l.id, { status: 'missing', missingReason: 'not_found' });
    const close = await db.prepare(d.shipment.id, OWNER_EXAMPLE.totalCents);
    expect(close.status).toBe(200);
    expect(close.body.outcome).toBe('closed_nothing_to_ship');
    let o = await db.clientOrder(d.order.id, tok);
    expect(o.body.status).toBe('settled'); // el webhook `charge.refunded` aún no llegó
    expect(o.body.publicStatus).toBe('reembolsado'); // la regla v1.80: todo devuelto por Stripe
    expect(o.body.refundedCents).toBe(OWNER_EXAMPLE.totalCents);
    expect(o.body.shipment).toMatchObject({ status: 'cancelado', missingCount: 2 });
    expect(o.body.items.map((i: any) => i.refund?.amountCents)).toEqual(expect.arrayContaining([52430, 31458]));
    // contracargo de un directo ⇒ envío cancelado + orden chargeback ⇒ en_revision
    const e = await db.mkDirect({ userId: u.id, guestEmail: null });
    const wh = await h.sendStripeWebhook({ type: 'charge.dispute.created', data: { object: { object: 'dispute', payment_intent: e.pi } } });
    expect(wh.status).toBe(200);
    o = await db.clientOrder(e.order.id, tok);
    expect(o.body.publicStatus).toBe('en_revision');
    expect(o.body.shipment.status).toBe('cancelado');
    // envío cancelado + orden settled sin reembolso total ⇒ en_revision (⛔ nunca pagado/preparando)
    const f = await db.mkDirect({ userId: u.id, guestEmail: null });
    await h.prisma.shipmentRequest.update({ where: { id: f.shipment.id }, data: { status: 'cancelado' } });
    o = await db.clientOrder(f.order.id, tok);
    expect(o.body.publicStatus).toBe('en_revision');
    // PO-5: re-expedición — A cancelado (más viejo) + B picking ⇒ B; todos cancelados ⇒ el más reciente
    const b = await h.prisma.shipmentRequest.create({
      data: { orderId: f.order.id, userId: null, addressSnapshot: f.shipment.addressSnapshot as object, status: 'picking', pickingAt: new Date(), shippingFeeCents: 0, ivaCents: 0, processingFeeCents: 0, totalCents: 0, priceConvention: 'IVA_INCLUSIVE', requestedAt: new Date(Date.now() + 1000) },
    });
    db.shipments.push(b.id);
    o = await db.clientOrder(f.order.id, tok);
    expect(o.body.shipment.id).toBe(b.id);
    expect(o.body.publicStatus).toBe('preparando');
    await h.prisma.shipmentRequest.update({ where: { id: b.id }, data: { status: 'cancelado' } });
    o = await db.clientOrder(f.order.id, tok);
    expect(o.body.shipment.id).toBe(b.id);
    expect(o.body.publicStatus).toBe('en_revision');
    // Mutación: calcular el rótulo con `order.status` a secas; tomar el primero por `requestedAt asc`.
  });

  it('PO-3 — PARIDAD: para 12 combinaciones el `status` de `POST /orders/guest/track` y el `publicStatus` de `GET /orders/:id` son idénticos', async () => {
    const u = await db.mkUser('PO-3');
    const tok = await db.loginCustomer(u.email!);
    // un pedido reclamado: tiene dueño (GET /orders/:id) Y correo de invitado (track por token)
    const d = await db.mkDirect({ userId: u.id, guestEmail: `po3.${RUN}@e2e.local` });
    const tokens = h.app.get(OrderAccessTokenService);
    const { clear } = await tokens.issue(d.order.id);
    const combos: { order: string; shipment: string | null; refundAll?: boolean }[] = [
      { order: 'pending', shipment: null },
      { order: 'failed', shipment: null },
      { order: 'refunded', shipment: 'picking' },
      { order: 'chargeback', shipment: 'cancelado' },
      { order: 'settled', shipment: null },
      { order: 'settled', shipment: 'solicitado' },
      { order: 'settled', shipment: 'picking' },
      { order: 'settled', shipment: 'guia' },
      { order: 'settled', shipment: 'enviado' },
      { order: 'settled', shipment: 'entregado' },
      { order: 'settled', shipment: 'cancelado' },
      { order: 'settled', shipment: 'cancelado', refundAll: true },
    ];
    const seen: string[] = [];
    for (const c of combos) {
      await h.prisma.order.update({ where: { id: d.order.id }, data: { status: c.order as never } });
      if (c.shipment === null) await h.prisma.shipmentRequest.deleteMany({ where: { id: d.shipment.id } });
      else await h.prisma.shipmentRequest.upsert({ where: { id: d.shipment.id }, create: { id: d.shipment.id, orderId: d.order.id, addressSnapshot: d.shipment.addressSnapshot as object, status: c.shipment as never, shippingFeeCents: 0, ivaCents: 0, processingFeeCents: 0, totalCents: 0, priceConvention: 'IVA_INCLUSIVE' }, update: { status: c.shipment as never } });
      await h.prisma.paymentRefund.deleteMany({ where: { orderId: d.order.id } });
      if (c.refundAll) {
        await h.prisma.paymentRefund.create({ data: { idempotencyKey: `po3:${d.order.id}`, kind: 'order_remaining', orderId: d.order.id, amountCents: d.order.totalCents, merchandiseCents: d.order.totalCents, merchandiseIvaCents: 0, shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 0, status: 'submitted', stripeRefundId: `re_po3_${d.order.id}`, requestedByUserId: db.adminId, requestedByRole: 'super_admin', submittedAt: new Date() } });
      }
      const mine = await db.clientOrder(d.order.id, tok);
      const guest = await db.guestTrack(clear);
      expect(mine.status).toBe(200);
      expect(guest.status).toBe(200);
      expect(mine.body.publicStatus).toBe(guest.body.status);
      expect(mine.body.refundedCents).toBe(guest.body.refundedCents);
      seen.push(mine.body.publicStatus);
    }
    expect(seen).toEqual(['pendiente_pago', 'cancelado', 'reembolsado', 'en_revision', 'pagado', 'preparando', 'preparando', 'guia', 'enviado', 'entregado', 'en_revision', 'reembolsado']);
    // Mutación: una segunda tabla de mapeo con una fila distinta (p. ej. `cancelado ⇒ 'cancelado'`).
  });

  it('PO-6 / PO-7 — orden `vault` ⇒ `shipment:null`; línea con caso `open` ⇒ `items[].replacement.status:open`; `refunded` con SPEI pending ⇒ `refund.byTransferCents>0`; sin `reason`/CLABE/actor; orden ajena ⇒ 403 sin cuerpo', async () => {
    const u = await db.mkUser('PO-6');
    const tok = await db.loginCustomer(u.email!);
    const drawer = await db.mkDrawer();
    const vo = await db.mkVaultOrder(u.id, { placement: 'pending', locationId: drawer.id });
    const items = await h.prisma.vaultPlacementItem.findMany({ where: { placementId: vo.placement!.id } });
    await db.vpMark(vo.placement!.id, items.find((i) => i.inventoryItemId === vo.pieces[0].id)!.id, { status: 'missing', missingReason: 'damaged' });
    await db.vpMark(vo.placement!.id, items.find((i) => i.inventoryItemId === vo.pieces[1].id)!.id, { status: 'picked' });
    await db.vpPrepare(vo.placement!.id);
    const conf = await db.vpConfirm(vo.placement!.id, { locationId: drawer.id });
    const caseId = conf.body.items.find((i: any) => i.result === 'missing').caseId;
    let o = await db.clientOrder(vo.order.id, tok);
    expect(o.body).toMatchObject({ fulfillmentMode: 'vault', shipment: null, publicStatus: 'pagado' });
    const line = o.body.items.find((i: any) => i.inventoryItemId === vo.pieces[0].id);
    expect(line.replacement).toEqual({ status: 'open', reason: 'damaged', refund: null });
    // reembolso del caso todo por SPEI (remanente 0)
    await h.prisma.paymentRefund.create({ data: { idempotencyKey: `po6:${vo.order.id}`, kind: 'order_full', orderId: vo.order.id, amountCents: vo.order.totalCents, merchandiseCents: 80000, merchandiseIvaCents: 80000 - Math.floor(80000 / 1.16), shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 4617, status: 'succeeded', stripeRefundId: `re_po6_${vo.order.id}`, requestedByUserId: db.adminId, requestedByRole: 'super_admin', submittedAt: new Date(), succeededAt: new Date() } });
    await db.mkKyc(u.id, '012345678901234567');
    const pv = await db.casePreview(caseId, 52885);
    expect((await db.caseRefund(caseId, { amountCents: 52885, reason: 'motivo interno', expectedStripeCents: pv.body.stripeCents, expectedManualCents: pv.body.manualCents })).status).toBe(200);
    o = await db.clientOrder(vo.order.id, tok);
    const line2 = o.body.items.find((i: any) => i.inventoryItemId === vo.pieces[0].id);
    expect(line2.replacement).toEqual({ status: 'refunded', reason: 'damaged', refund: { amountCents: 52885, byTransferCents: 52885, transferStatus: 'pending' } });
    const json = JSON.stringify(o.body);
    expect(json).not.toMatch(/motivo interno|012345678901234567|openedBy|resolvedBy|marketRef|referenceCents/);
    // PO-7: orden ajena ⇒ 403 sin cuerpo de envío
    const other = await db.mkUser('PO-7');
    const tok2 = await db.loginCustomer(other.email!);
    const denied = await db.clientOrder(vo.order.id, tok2);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toMatch(/shipment|publicStatus/);
    // Mutación: proyectar el caso sin filtrar campos; quitar la guarda de dueño.
  });
});
