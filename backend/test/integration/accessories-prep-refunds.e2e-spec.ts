/**
 * 💰 Stream (B) de accesorios — PREPARACIÓN y REEMBOLSOS contra Postgres REAL (§AC.9, §AC.10, §AC.12, §AC.19.5/.6).
 * Pedidos creados por HTTP real (quote → session → webhook firmado); preparación y M3 por los verbos reales.
 *
 *  AC-B18 renglones en el detalle y la hoja · AC-B19 «faltó 1 de 3» · AC-B20 reembolso total según si salió ·
 *  AC-B21 cierre `order_remaining` con accesorios · AC-B22 entregado por unidad + carrera (N=10) · AC-B35 paquete ·
 *  AC-B41 importe por renglón y `refundPreviewCents` · AC-B42 `deckShipmentItemIds`/`deckAllMissing` · AC-B52 el verbo
 *  · AC-B55 foto vigente · AC-B58 el PATCH · AC-B59 conteos · AC-B60 `OrderAccessoryLineDTO` en M3 y seguimiento
 *  · AC-B62 (v1.86.4, §AC.20.3) Stripe rechaza el reembolso total y luego llega `charge.refunded` ⇒ se repone UNA vez.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { AccDb, FUNDA_DIMS } from './helpers/accessories-b-db';
import { itemMissingRefundComponents, orderRemainingRefundComponents } from '../../src/common/money';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = `acbp${Date.now().toString(36)}`;
const N = Number(process.env.ACB_RACE_N ?? 10);

describe('💰 Accesorios (B) — preparación y reembolsos (Postgres real)', () => {
  let h: E2EHarness;
  let db: AccDb;
  const code = (r: { status: number; body: any }) => `${r.status}:${r.body?.error?.code ?? ''}`;
  const report = (id: string, outcomes: string[], ok: (o: string) => boolean) => {
    const k = outcomes.filter(ok).length;
    // eslint-disable-next-line no-console
    console.log(`[ACB-RACE ${id}] ${k}/${outcomes.length} · N=${outcomes.length} · ${outcomes.join(' | ')}`);
    return k;
  };
  const orderMoney = (id: string) => h.prisma.order.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    db = new AccDb(h, RUN);
    await db.init();
  });

  afterAll(async () => {
    await db?.cleanup();
    await h?.close();
  });

  beforeEach(() => {
    h.stripe.refundOutcome = 'ok';
  });

  /** Directo liquidado: `cards` cartas + funda ×`fundas` (+ paquete del deck si `bundle`). */
  async function paid(o: { cards?: number; fundas?: number; bundle?: boolean; fundaPrice?: number } = {}) {
    const funda = await db.mkAccessory({ name: `Penny sleeves ${RUN}`, priceCents: o.fundaPrice ?? 8900, stockQty: 50, unitCostCents: 3000, dims: FUNDA_DIMS });
    const items = [];
    for (let i = 0; i < (o.cards ?? 1); i += 1) items.push((await db.mkItem({ listPriceCents: 30000 })).id);
    const json: Record<string, unknown> = { inventoryItemIds: items };
    if ((o.fundas ?? 3) > 0) json.accessoryLines = [{ accessoryId: funda.id, quantity: o.fundas ?? 3 }];
    let deck: Awaited<ReturnType<AccDb['mkDeck']>> | null = null;
    if (o.bundle) {
      await db.setEnergy('fire', { stockQty: 40, unitCostCents: 200 });
      await db.setEnergy('psychic', { stockQty: 40, unitCostCents: 200 });
      deck = await db.mkDeck({ cards: 2, energies: [{ rawName: 'Basic Fire Energy', quantity: 8 }, { rawName: 'Basic Psychic Energy', quantity: 4 }] });
      json.deckPulls = [{ pullToken: db.token(deck, items), withEnergyBundle: true }];
    }
    const p = await db.paidOrder(json);
    const sal = await h.prisma.shipmentAccessoryLine.findMany({ where: { shipmentRequestId: p.shipmentId }, include: { orderAccessoryLine: true } });
    const fundaLine = sal.find((l) => l.orderAccessoryLine.kind === 'accessory') ?? null;
    const bundleLine = sal.find((l) => l.orderAccessoryLine.kind === 'energy_bundle') ?? null;
    const cardLines = await h.prisma.shipmentItem.findMany({ where: { shipmentRequestId: p.shipmentId } });
    return { ...p, funda, items, deck, fundaLine, bundleLine, cardLines, order: await orderMoney(p.orderId) };
  }

  // ================================================================ AC-B18 / B59 / B58

  describe('AC-B18 / AC-B59 detalle, hoja y conteos (criterios 715, 743)', () => {
    it('detalle y hoja listan el renglón (ShipAccessoryLineDTO); conteos SOLO de cartas', async () => {
      const p = await paid({ cards: 2, fundas: 3 });
      const det = await db.shipmentDetail(p.shipmentId);
      expect(det.status).toBe(200);
      const amounts = [1, 2, 3].map((k) => itemMissingRefundComponents(p.order, k * 8900).amountCents);
      const expected = {
        id: p.fundaLine!.id,
        kind: 'accessory',
        name: `Penny sleeves ${RUN}`,
        photo: { url: expect.stringContaining(`/photo/${p.funda.photoVersion}/full`), thumbUrl: expect.stringContaining('/thumb') },
        quantity: 3,
        deckName: null,
        components: [],
        prepStatus: 'pending',
        missingQty: 0,
        missingReason: null,
        settledWithoutStock: false,
        refunded: false,
        refund: { kind: 'refundable', amountByQtyCents: amounts, amountCents: amounts[2] },
        deckShipmentItemIds: [],
        deckAllMissing: false,
      };
      expect(det.body.accessoryLines).toEqual([expected]);
      const sheet = await db.pickingList();
      const row = (sheet.body.data as any[]).find((x) => x.shipmentId === p.shipmentId);
      expect(row.accessoryLines).toEqual([expected]);
      expect(row.preparation).toMatchObject({ status: 'in_progress', total: 2, pending: 2, picked: 0, missing: 0, blocked: 0, refundPreviewCents: 0 });
      expect(row.box).toBeNull();
    });

    it('cartas palomeadas + renglón pending ⇒ POST prepared 409 PREPARATION_INCOMPLETE {pendingCount:0, pendingAccessoryCount:1}', async () => {
      const p = await paid({ cards: 2, fundas: 1 });
      for (const l of p.cardLines) expect((await db.markCard(p.shipmentId, l.id, { status: 'picked' })).status).toBe(200);
      const r = await db.prepare(p.shipmentId, 0);
      expect(code(r)).toBe('409:PREPARATION_INCOMPLETE');
      expect(r.body.error.details).toEqual({ pendingCount: 0, pendingAccessoryCount: 1 });
    });

    it('I-AC-5: directo SIN accesorios ⇒ conteos y detalle como hoy (accessoryLines [] y box null)', async () => {
      const p = await paid({ cards: 2, fundas: 0 });
      const det = await db.shipmentDetail(p.shipmentId);
      expect(det.body.accessoryLines).toEqual([]);
      expect(det.body.box).toBeNull();
      const r = await db.prepare(p.shipmentId, 0);
      expect(code(r)).toBe('409:PREPARATION_INCOMPLETE');
      expect(r.body.error.details).toEqual({ pendingCount: 2, pendingAccessoryCount: 0 });
    });
  });

  describe('AC-B58 PATCH …/prep-accessory-lines/:lineId (§AC.19.5)', () => {
    it('respuesta {changed, line, preparation}; el preview ya trae el faltante; repetir ⇒ changed:false sin bitácora', async () => {
      const p = await paid({ cards: 1, fundas: 3 });
      const r = await db.markAcc(p.shipmentId, p.fundaLine!.id, { status: 'missing', missingQty: 1, missingReason: 'not_found' });
      expect(r.status).toBe(200);
      expect(r.body.changed).toBe(true);
      expect(r.body.line).toMatchObject({ id: p.fundaLine!.id, prepStatus: 'missing', missingQty: 1, missingReason: 'not_found' });
      const one = itemMissingRefundComponents(p.order, 8900).amountCents;
      expect(r.body.line.refund).toMatchObject({ kind: 'refundable', amountCents: one });
      expect(r.body.preparation.refundPreviewCents).toBe(one);
      expect(r.body.preparation.total).toBe(1);
      const audits = () => h.prisma.auditLog.count({ where: { entityId: p.shipmentId, action: 'shipment.accessory_line_marked' } });
      expect(await audits()).toBe(1);
      const again = await db.markAcc(p.shipmentId, p.fundaLine!.id, { status: 'missing', missingQty: 1, missingReason: 'not_found' });
      expect(again.status).toBe(200);
      expect(again.body.changed).toBe(false);
      expect(await audits()).toBe(1);
      const log = await h.prisma.auditLog.findFirstOrThrow({ where: { entityId: p.shipmentId, action: 'shipment.accessory_line_marked' } });
      expect(log.after).toMatchObject({ shipmentAccessoryLineId: p.fundaLine!.id });
      // ⛔ cero dinero y cero existencias
      expect(await h.prisma.paymentRefund.count({ where: { orderId: p.orderId } })).toBe(0);
      expect(await db.stockOf(p.funda.id)).toEqual({ stockQty: 47, reservedQty: 0 });
    });

    it('400: missing sin missingQty/motivo, missingQty > quantity, picked con missingReason, paquete con missingQty 2', async () => {
      const p = await paid({ cards: 2, fundas: 2, bundle: true });
      const l = p.fundaLine!.id;
      for (const body of [
        { status: 'missing', missingReason: 'not_found' },
        { status: 'missing', missingQty: 1 },
        { status: 'missing', missingQty: 3, missingReason: 'not_found' },
        { status: 'missing', missingQty: 0, missingReason: 'not_found' },
        { status: 'picked', missingReason: 'not_found' },
        { status: 'picked', missingQty: 1 },
        { status: 'nope' },
      ]) {
        const r = await db.markAcc(p.shipmentId, l, body);
        expect({ body, r: code(r) }).toEqual({ body, r: '400:VALIDATION_ERROR' });
      }
      const b = await db.markAcc(p.shipmentId, p.bundleLine!.id, { status: 'missing', missingQty: 2, missingReason: 'not_found' });
      expect(code(b)).toBe('400:VALIDATION_ERROR');
      expect(b.body.error.details.field).toBe('missingQty');
      expect(code(await db.markAcc('00000000-0000-4000-8000-000000000000', l, { status: 'picked' }))).toBe('404:NOT_FOUND');
      const other = await paid({ cards: 1, fundas: 1 });
      expect(code(await db.markAcc(p.shipmentId, other.fundaLine!.id, { status: 'picked' }))).toBe('404:NOT_FOUND');
    });

    it('409: envío preparado ⇒ PREPARATION_CLOSED; con fila acc-item ⇒ PREP_ITEM_REFUNDED (tras deshacer el preparado)', async () => {
      const p = await paid({ cards: 1, fundas: 3 });
      await db.markCard(p.shipmentId, p.cardLines[0].id, { status: 'picked' });
      await db.markAcc(p.shipmentId, p.fundaLine!.id, { status: 'missing', missingQty: 1, missingReason: 'damaged' });
      const prev = itemMissingRefundComponents(p.order, 8900).amountCents;
      expect((await db.prepare(p.shipmentId, prev)).status).toBe(200);
      expect(code(await db.markAcc(p.shipmentId, p.fundaLine!.id, { status: 'picked' }))).toBe('409:PREPARATION_CLOSED');
      expect((await h.api('DELETE', `/admin/shipments/${p.shipmentId}/prepared`, { token: db.opToken })).status).toBe(200);
      const r = await db.markAcc(p.shipmentId, p.fundaLine!.id, { status: 'picked' });
      expect(code(r)).toBe('409:PREP_ITEM_REFUNDED');
      expect(r.body.error.details.refundId).toEqual(expect.any(String));
    });
  });

  // ================================================================ AC-B19 / B41 / B42 / B21

  describe('AC-B19 💰 «faltó 1 de 3» (criterio 716)', () => {
    it('fila item_missing acc-item:<id> con itemMissingRefundComponents(order, 1×P); refundedQty +1; tope del operador; el pedido sigue', async () => {
      const p = await paid({ cards: 1, fundas: 3 });
      await db.markCard(p.shipmentId, p.cardLines[0].id, { status: 'picked' });
      await db.markAcc(p.shipmentId, p.fundaLine!.id, { status: 'missing', missingQty: 1, missingReason: 'not_found' });
      const comp = itemMissingRefundComponents(p.order, 8900);
      const stale = await db.prepare(p.shipmentId, comp.amountCents - 1);
      expect(code(stale)).toBe('409:REFUND_PREVIEW_STALE');
      expect(stale.body.error.details).toEqual({ refundCents: comp.amountCents });
      const r = await db.prepare(p.shipmentId, comp.amountCents);
      expect(r.status).toBe(200);
      expect(r.body.outcome).toBe('prepared');
      const rows = await h.prisma.paymentRefund.findMany({ where: { orderId: p.orderId } });
      expect(rows).toHaveLength(1);
      const operator = await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.operator.email } });
      expect(rows[0]).toMatchObject({
        kind: 'item_missing',
        idempotencyKey: `acc-item:${p.fundaLine!.id}`,
        orderAccessoryLineId: p.fundaLine!.orderAccessoryLineId,
        shipmentAccessoryLineId: p.fundaLine!.id,
        accessoryQty: 1,
        missingReason: 'not_found',
        orderItemId: null,
        shipmentItemId: null,
        amountCents: comp.amountCents,
        merchandiseCents: comp.merchandiseCents,
        merchandiseIvaCents: comp.merchandiseIvaCents,
        processingFeeCents: comp.processingFeeCents,
        shippingCents: 0,
        requestedByUserId: operator.id,
      });
      expect(['requested', 'submitted', 'succeeded']).toContain(rows[0].status);
      expect((await h.prisma.orderAccessoryLine.findUniqueOrThrow({ where: { id: p.fundaLine!.orderAccessoryLineId } })).refundedQty).toBe(1);
      expect((await orderMoney(p.orderId)).status).toBe('settled');
      expect((await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id: p.shipmentId } })).status).toBe('picking');
      const det = await db.shipmentDetail(p.shipmentId);
      expect(det.body.accessoryLines[0].refunded).toBe(true);
      expect(det.body.accessoryLines[0].refund).toMatchObject({ kind: 'refunded', refund: { id: rows[0].id, amountCents: comp.amountCents } });
    });
  });

  describe('AC-B41 💰 importe por renglón y refundPreviewCents (v1.86.1)', () => {
    it('1 carta + funda ×3 + paquete: 2 fundas y el paquete faltan ⇒ preview = [1] + paquete (+ carta si falta); prepared exige ese número', async () => {
      const p = await paid({ cards: 2, fundas: 3, bundle: true });
      const [c0, c1] = p.cardLines;
      await db.markCard(p.shipmentId, c0.id, { status: 'picked' });
      await db.markCard(p.shipmentId, c1.id, { status: 'picked' });
      const f = await db.markAcc(p.shipmentId, p.fundaLine!.id, { status: 'missing', missingQty: 2, missingReason: 'damaged' });
      const two = itemMissingRefundComponents(p.order, 2 * 8900).amountCents;
      expect(f.body.line.refund.amountByQtyCents[1]).toBe(two);
      expect(f.body.line.refund.amountCents).toBe(two);
      const b = await db.markAcc(p.shipmentId, p.bundleLine!.id, { status: 'missing', missingQty: 1, missingReason: 'not_found' });
      const pack = itemMissingRefundComponents(p.order, 2000).amountCents;
      expect(b.body.line.refund).toEqual({ kind: 'refundable', amountByQtyCents: [pack], amountCents: pack });
      expect(b.body.preparation.refundPreviewCents).toBe(two + pack);
      // + la carta si falta
      const card = itemMissingRefundComponents(p.order, (await h.prisma.orderItem.findFirstOrThrow({ where: { orderId: p.orderId, inventoryItemId: c1.inventoryItemId } })).unitPriceCents).amountCents;
      const c = await db.markCard(p.shipmentId, c1.id, { status: 'missing', missingReason: 'not_found' });
      expect(c.body.preparation.refundPreviewCents).toBe(two + pack + card);
      expect(code(await db.prepare(p.shipmentId, two + pack + card - 1))).toBe('409:REFUND_PREVIEW_STALE');
      const r = await db.prepare(p.shipmentId, two + pack + card);
      expect(r.status).toBe(200);
      const rows = await h.prisma.paymentRefund.findMany({ where: { orderId: p.orderId } });
      expect(rows.map((x) => x.idempotencyKey).sort()).toEqual([`acc-item:${p.bundleLine!.id}`, `acc-item:${p.fundaLine!.id}`, `item:${c1.id}`].sort());
      const det = await db.shipmentDetail(p.shipmentId);
      for (const l of det.body.accessoryLines) expect(l.refund.kind).toBe('refunded');
    });
  });

  describe('AC-B42 deckShipmentItemIds / deckAllMissing (v1.86.1)', () => {
    it('ids = ShipmentItem de las piezas firmadas; todas missing ⇒ true (y el servidor NO marca el paquete); una picked ⇒ false', async () => {
      const p = await paid({ cards: 2, fundas: 1, bundle: true });
      const det = await db.shipmentDetail(p.shipmentId);
      const bundle = det.body.accessoryLines.find((l: { kind: string }) => l.kind === 'energy_bundle');
      const funda = det.body.accessoryLines.find((l: { kind: string }) => l.kind === 'accessory');
      expect([...bundle.deckShipmentItemIds].sort()).toEqual(p.cardLines.map((l) => l.id).sort());
      expect(bundle.components).toEqual([{ energyType: 'fire', quantity: 8 }, { energyType: 'psychic', quantity: 4 }]);
      expect(bundle).toMatchObject({ name: p.deck!.name, deckName: p.deck!.name, photo: null, quantity: 1 });
      expect(bundle.deckAllMissing).toBe(false);
      expect(funda.deckShipmentItemIds).toEqual([]);
      expect(funda.deckAllMissing).toBe(false);
      await db.markCard(p.shipmentId, p.cardLines[0].id, { status: 'missing', missingReason: 'not_found' });
      const half = (await db.shipmentDetail(p.shipmentId)).body.accessoryLines.find((l: { kind: string }) => l.kind === 'energy_bundle');
      expect(half.deckAllMissing).toBe(false);
      const r = await db.markCard(p.shipmentId, p.cardLines[1].id, { status: 'missing', missingReason: 'damaged' });
      expect(r.status).toBe(200);
      const all = (await db.shipmentDetail(p.shipmentId)).body.accessoryLines.find((l: { kind: string }) => l.kind === 'energy_bundle');
      expect(all.deckAllMissing).toBe(true);
      expect(all.prepStatus).toBe('pending');
      await db.markCard(p.shipmentId, p.cardLines[1].id, { status: 'picked' });
      const back = (await db.shipmentDetail(p.shipmentId)).body.accessoryLines.find((l: { kind: string }) => l.kind === 'energy_bundle');
      expect(back.deckAllMissing).toBe(false);
    });
  });

  describe('AC-B21 💰 cierre order_remaining con accesorios', () => {
    it('nada sale (carta y renglones faltantes enteros) ⇒ Σ amount = totalCents y Σ IVA = ivaCents (±0); el envío se cierra', async () => {
      const p = await paid({ cards: 1, fundas: 2, bundle: true });
      await db.markCard(p.shipmentId, p.cardLines[0].id, { status: 'missing', missingReason: 'not_found' });
      await db.markAcc(p.shipmentId, p.fundaLine!.id, { status: 'missing', missingQty: 2, missingReason: 'not_found' });
      const b = await db.markAcc(p.shipmentId, p.bundleLine!.id, { status: 'missing', missingQty: 1, missingReason: 'not_found' });
      expect(b.body.preparation.refundPreviewCents).toBe(p.order.totalCents);
      const r = await db.prepare(p.shipmentId, p.order.totalCents);
      expect(r.status).toBe(200);
      expect(r.body.outcome).toBe('closed_nothing_to_ship');
      const rows = await h.prisma.paymentRefund.findMany({ where: { orderId: p.orderId } });
      expect(rows.map((x) => x.kind).sort()).toEqual(['item_missing', 'item_missing', 'item_missing', 'order_remaining']);
      expect(rows.reduce((a, x) => a + x.amountCents, 0)).toBe(p.order.totalCents);
      expect(rows.reduce((a, x) => a + x.merchandiseIvaCents + x.shippingIvaCents, 0)).toBe(p.order.ivaCents);
      const rem = rows.find((x) => x.kind === 'order_remaining')!;
      expect(rem.amountCents).toBe(orderRemainingRefundComponents(p.order, rows.filter((x) => x.kind !== 'order_remaining')).amountCents);
      expect((await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id: p.shipmentId } })).status).toBe('cancelado');
    });

    it('si un renglón sale aunque sea parcial (funda 1 de 2) ⇒ ⛔ no cierra', async () => {
      const p = await paid({ cards: 1, fundas: 2 });
      await db.markCard(p.shipmentId, p.cardLines[0].id, { status: 'missing', missingReason: 'not_found' });
      const r = await db.markAcc(p.shipmentId, p.fundaLine!.id, { status: 'missing', missingQty: 1, missingReason: 'not_found' });
      const one = itemMissingRefundComponents(p.order, 8900).amountCents;
      const oiPrice = (await h.prisma.orderItem.findFirstOrThrow({ where: { orderId: p.orderId } })).unitPriceCents;
      expect(r.body.preparation.refundPreviewCents).toBe(itemMissingRefundComponents(p.order, oiPrice).amountCents + one);
    });
  });

  // ================================================================ AC-B20 / B35 reembolso total

  describe('AC-B20 💰 reembolso total según si salió (criterios 717, 744)', () => {
    it('NO enviado ⇒ vuelven quantity − missingQty (movimiento restock, renglón restocked); paquete ⇒ por tipo', async () => {
      const p = await paid({ cards: 2, fundas: 3, bundle: true });
      for (const l of p.cardLines) await db.markCard(p.shipmentId, l.id, { status: 'picked' });
      await db.markAcc(p.shipmentId, p.fundaLine!.id, { status: 'missing', missingQty: 1, missingReason: 'damaged' });
      await db.markAcc(p.shipmentId, p.bundleLine!.id, { status: 'picked' });
      const prev = itemMissingRefundComponents(p.order, 8900).amountCents;
      expect((await db.prepare(p.shipmentId, prev)).status).toBe(200);
      const before = { funda: await db.stockOf(p.funda.id), fire: await db.stockOf(db.energy.fire), psy: await db.stockOf(db.energy.psychic) };
      const r = await db.fullRefund(p.orderId, { reason: 'el cliente canceló' });
      expect(r.status).toBe(201);
      expect(await db.stockOf(p.funda.id)).toEqual({ stockQty: before.funda.stockQty + 2, reservedQty: 0 });
      expect(await db.stockOf(db.energy.fire)).toEqual({ stockQty: before.fire.stockQty + 8, reservedQty: 0 });
      expect(await db.stockOf(db.energy.psychic)).toEqual({ stockQty: before.psy.stockQty + 4, reservedQty: 0 });
      const lines = await h.prisma.orderAccessoryLine.findMany({ where: { orderId: p.orderId } });
      for (const l of lines) {
        expect(l.status).toBe('restocked');
        expect(l.restockedAt).not.toBeNull();
      }
      const mv = await h.prisma.accessoryStockMovement.findMany({ where: { orderId: p.orderId, kind: 'restock' } });
      expect(mv.map((m) => m.delta).sort((a, b) => a - b)).toEqual([2, 4, 8]);
      // Segunda pasada (charge.refunded): no repone dos veces.
      await h.sendStripeWebhook({
        type: 'charge.refunded',
        data: { object: { id: `ch_${RUN}_${Date.now()}`, object: 'charge', payment_intent: p.s.body.stripe.paymentIntentId, amount: p.total, amount_refunded: p.total } },
      });
      expect(await db.stockOf(p.funda.id)).toEqual({ stockQty: before.funda.stockQty + 2, reservedQty: 0 });
    });

    it('AC-B62 💰 Stripe RECHAZA el reembolso total y después llega charge.refunded ⇒ las fundas vuelven UNA sola vez (§AC.20.3)', async () => {
      const funda = await db.mkAccessory({ name: `Penny sleeves ${RUN} B62`, priceCents: 8900, stockQty: 10, unitCostCents: 3000, dims: FUNDA_DIMS });
      const item = await db.mkItem({ listPriceCents: 30000 });
      const p = await db.paidOrder({ inventoryItemIds: [item.id], accessoryLines: [{ accessoryId: funda.id, quantity: 3 }] });
      expect(await db.stockOf(funda.id)).toEqual({ stockQty: 7, reservedQty: 0 });
      const restocks = () => h.prisma.accessoryStockMovement.findMany({ where: { orderId: p.orderId, kind: 'restock' } });

      // (1) M3 total, NO enviado, con el doble de Stripe rechazando (StripeInvalidRequestError ⇒ fila `failed`).
      h.stripe.refundOutcome = 'definitive';
      await db.fullRefund(p.orderId, { reason: 'el cliente canceló' });
      const row = await h.prisma.paymentRefund.findFirstOrThrow({ where: { orderId: p.orderId, kind: 'order_full' } });
      expect(row.status).toBe('failed');
      // Las unidades volvieron en la tx1 de M3 (no en la confirmación, que no llegó): 7 → 10 aunque Stripe rechazó.
      expect(await db.stockOf(funda.id)).toEqual({ stockQty: 10, reservedQty: 0 });
      expect((await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id: p.shipmentId } })).status).toBe('cancelado');
      const line = await h.prisma.orderAccessoryLine.findFirstOrThrow({ where: { orderId: p.orderId } });
      expect(line.status).toBe('restocked');
      expect((await restocks()).map((m) => [m.accessoryId, m.delta, m.stockBefore, m.stockAfter])).toEqual([[funda.id, 3, 7, 10]]);

      // (2) El reembolso se rehace fuera (panel de Stripe) ⇒ charge.refunded TOTAL del mismo PI: ⛔ no repone otra vez.
      h.stripe.refundOutcome = 'ok';
      const wh = await h.sendStripeWebhook({
        type: 'charge.refunded',
        data: { object: { id: `ch_${RUN}_b62_${Date.now()}`, object: 'charge', payment_intent: p.s.body.stripe.paymentIntentId, amount: p.total, amount_refunded: p.total } },
      });
      expect(wh.status).toBe(200);
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: p.orderId } })).status).toBe('refunded');
      expect(await db.stockOf(funda.id)).toEqual({ stockQty: 10, reservedQty: 0 });
      expect(await restocks()).toHaveLength(1);
    });

    it('ENVIADO ⇒ nada vuelve (y M3 pide el motivo «tras envío»)', async () => {
      const p = await paid({ cards: 1, fundas: 2 });
      await db.shipAll(p.shipmentId, 'enviado');
      const before = await db.stockOf(p.funda.id);
      expect(code(await db.fullRefund(p.orderId, { reason: 'no llegó' }))).toBe('422:REFUND_CONFIRMATION_REQUIRED');
      const r = await db.fullRefund(p.orderId, { reason: 'no llegó', shippedReason: 'not_arrived' });
      expect(r.status).toBe(201);
      expect(await db.stockOf(p.funda.id)).toEqual(before);
      expect((await h.prisma.orderAccessoryLine.findFirstOrThrow({ where: { orderId: p.orderId } })).status).toBe('sold');
    });
  });

  // ================================================================ AC-B52 / B22 / B35 entregado

  describe('AC-B52 💰 el verbo POST /admin/orders/:id/accessory-lines/:lineId/refund-delivered (§AC.10 (2))', () => {
    const body = (extra: Record<string, unknown>) => ({ quantity: 1, reason: 'arrived_damaged', note: 'llegó rota la caja', ...extra });

    it('validación ⇒ 400 {field}; operador ⇒ 403; A−1 ⇒ 409 STALE {refundCents:A} y cero filas; correcto ⇒ 201; k=1,2 hasta fully_refunded', async () => {
      const p = await paid({ cards: 1, fundas: 3 });
      await db.shipAll(p.shipmentId, 'entregado');
      const lineId = p.fundaLine!.orderAccessoryLineId;
      const m3 = async () => (await db.adminOrder(p.orderId)).body.accessoryLines.find((l: { id: string }) => l.id === lineId);
      let view = await m3();
      expect(view.deliveredRefund).toEqual({ kind: 'refundable', refundableQty: 3, amountByQtyCents: [1, 2, 3].map((k) => itemMissingRefundComponents(p.order, k * 8900).amountCents) });
      const A1 = view.deliveredRefund.amountByQtyCents[0];
      for (const [b, field] of [
        [{ quantity: 1, reason: 'arrived_damaged', expectedRefundCents: A1 }, 'note'],
        [body({ note: 'ab', expectedRefundCents: A1 }), 'note'],
        [body({ quantity: 0, expectedRefundCents: A1 }), 'quantity'],
        [body({ quantity: 1.5, expectedRefundCents: A1 }), 'quantity'],
        [body({ reason: 'whatever', expectedRefundCents: A1 }), 'reason'],
        [body({}), 'expectedRefundCents'],
      ] as const) {
        const r = await db.refundAccDelivered(p.orderId, lineId, b);
        expect({ field, r: code(r), f: r.body?.error?.details?.field }).toEqual({ field, r: '400:VALIDATION_ERROR', f: field });
      }
      expect(code(await db.refundAccDelivered(p.orderId, lineId, body({ expectedRefundCents: A1 }), db.opToken))).toBe('403:MONEY_OUT_FORBIDDEN');
      const stale = await db.refundAccDelivered(p.orderId, lineId, body({ expectedRefundCents: A1 - 1 }));
      expect(code(stale)).toBe('409:REFUND_PREVIEW_STALE');
      expect(stale.body.error.details).toEqual({ refundCents: A1 });
      expect(await h.prisma.paymentRefund.count({ where: { orderId: p.orderId } })).toBe(0);
      expect(code(await db.refundAccDelivered(p.orderId, 'no-existe', body({ expectedRefundCents: A1 })))).toBe('404:NOT_FOUND');

      const ok = await db.refundAccDelivered(p.orderId, lineId, body({ expectedRefundCents: A1, amountCents: 1 }));
      expect(ok.status).toBe(201);
      expect(ok.body.refund).toMatchObject({ kind: 'item_delivered', amountCents: A1, deliveredReason: 'arrived_damaged', missingReason: null });
      const [row] = await h.prisma.paymentRefund.findMany({ where: { orderId: p.orderId } });
      expect(row).toMatchObject({
        kind: 'item_delivered',
        idempotencyKey: `acc-delivered:${lineId}:1`,
        orderAccessoryLineId: lineId,
        accessoryQty: 1,
        reason: 'llegó rota la caja',
        missingReason: null,
        shipmentAccessoryLineId: null,
        orderItemId: null,
      });
      view = await m3();
      expect(view.refundedQty).toBe(1);
      expect(view.deliveredRefund.refundableQty).toBe(2);
      const A2 = view.deliveredRefund.amountByQtyCents[1];
      expect(A2).toBe(itemMissingRefundComponents(p.order, 2 * 8900).amountCents);
      const ok2 = await db.refundAccDelivered(p.orderId, lineId, body({ quantity: 2, expectedRefundCents: A2 }));
      expect(ok2.status).toBe(201);
      view = await m3();
      expect(view.refundedQty).toBe(3);
      expect(view.deliveredRefund).toEqual({ kind: 'not_refundable', reason: 'fully_refunded' });
      const more = await db.refundAccDelivered(p.orderId, lineId, body({ expectedRefundCents: A1 }));
      expect(code(more)).toBe('409:ACCESSORY_REFUND_EXCEEDS');
      expect(more.body.error.details).toEqual({ refundableQty: 0 });
      expect((await orderMoney(p.orderId)).status).toBe('settled');
    });

    it('k = 3 de una vez en otro pedido = amountByQtyCents[2]; no entregado ⇒ not_delivered y 409 ITEM_REFUND_NOT_AVAILABLE', async () => {
      const p = await paid({ cards: 1, fundas: 3 });
      const lineId = p.fundaLine!.orderAccessoryLineId;
      const early = (await db.adminOrder(p.orderId)).body.accessoryLines[0];
      expect(early.deliveredRefund).toEqual({ kind: 'not_refundable', reason: 'not_delivered' });
      const A3 = itemMissingRefundComponents(p.order, 3 * 8900).amountCents;
      const r0 = await db.refundAccDelivered(p.orderId, lineId, body({ quantity: 3, expectedRefundCents: A3 }));
      expect(code(r0)).toBe('409:ITEM_REFUND_NOT_AVAILABLE');
      expect(r0.body.error.details).toEqual({ reason: 'not_delivered' });
      await db.shipAll(p.shipmentId, 'entregado');
      const v = (await db.adminOrder(p.orderId)).body.accessoryLines[0];
      expect(v.deliveredRefund.amountByQtyCents[2]).toBe(A3);
      expect((await db.refundAccDelivered(p.orderId, lineId, body({ quantity: 3, expectedRefundCents: A3 }))).status).toBe(201);
    });

    it(`AC-B22 💰 dos actos simultáneos sobre la última unidad ⇒ uno 201, otro 409; refundedQty ≤ quantity (N=${N})`, async () => {
      const outcomes: string[] = [];
      for (let i = 0; i < N; i += 1) {
        const p = await paid({ cards: 0, fundas: 1 });
        await db.shipAll(p.shipmentId, 'entregado');
        const lineId = p.fundaLine!.orderAccessoryLineId;
        const A = itemMissingRefundComponents(p.order, 8900).amountCents;
        const [r1, r2] = await Promise.all([0, 1].map(() => db.refundAccDelivered(p.orderId, lineId, body({ expectedRefundCents: A }))));
        const line = await h.prisma.orderAccessoryLine.findUniqueOrThrow({ where: { id: lineId } });
        const rows = await h.prisma.paymentRefund.count({ where: { orderAccessoryLineId: lineId } });
        outcomes.push(`${[code(r1), code(r2)].sort().join(',')} refundedQty=${line.refundedQty} rows=${rows}`);
      }
      const ok = report('AC-B22', outcomes, (o) => o === '201:,409:ACCESSORY_REFUND_EXCEEDS refundedQty=1 rows=1');
      expect(ok).toBe(N);
    });
  });

  describe('AC-B35 💰 reembolso del paquete (P-EN-5, criterio 744)', () => {
    it('sin el deck reembolsado ⇒ 409 BUNDLE_REFUND_REQUIRES_DECK; con el deck entero ⇒ 201 itemMissingRefundComponents(order, 2000)', async () => {
      const p = await paid({ cards: 2, fundas: 0, bundle: true });
      await db.shipAll(p.shipmentId, 'entregado');
      const lineId = p.bundleLine!.orderAccessoryLineId;
      const A = itemMissingRefundComponents(p.order, 2000).amountCents;
      const v0 = (await db.adminOrder(p.orderId)).body.accessoryLines[0];
      expect(v0.deliveredRefund).toEqual({ kind: 'not_refundable', reason: 'bundle_requires_deck' });
      const r0 = await db.refundAccDelivered(p.orderId, lineId, { quantity: 1, reason: 'not_arrived', note: 'no llegó nada', expectedRefundCents: A });
      expect(code(r0)).toBe('409:BUNDLE_REFUND_REQUIRES_DECK');
      expect(code(await db.refundAccDelivered(p.orderId, lineId, { quantity: 2, reason: 'not_arrived', note: 'no llegó nada', expectedRefundCents: A }))).toBe('400:VALIDATION_ERROR');
      const detail = (await db.adminOrder(p.orderId)).body;
      for (const it of detail.items as { orderItemId: string; deliveredRefund: { amountCents: number } }[]) {
        const r = await h.api('POST', `/admin/orders/${p.orderId}/items/${it.orderItemId}/refund-delivered`, {
          token: db.adminToken,
          json: { reason: 'not_arrived', note: 'no llegó nada', expectedRefundCents: it.deliveredRefund.amountCents },
        });
        expect(r.status).toBe(201);
      }
      const v1 = (await db.adminOrder(p.orderId)).body.accessoryLines[0];
      expect(v1.deliveredRefund).toEqual({ kind: 'refundable', refundableQty: 1, amountByQtyCents: [A] });
      const ok = await db.refundAccDelivered(p.orderId, lineId, { quantity: 1, reason: 'not_arrived', note: 'no llegó nada', expectedRefundCents: A });
      expect(ok.status).toBe(201);
      expect(ok.body.refund.amountCents).toBe(A);
    });
  });

  // ================================================================ AC-B55 / B60

  describe('AC-B60 OrderAccessoryLineDTO en M3 y seguimiento (§AC.19.6) y AC-B55 foto vigente', () => {
    it('llaves EXACTAS (deliveredRefund solo en M3); foto reemplazada ⇒ versión NUEVA que responde 200; paquete ⇒ photo null', async () => {
      const p = await paid({ cards: 2, fundas: 2, bundle: true });
      const v2 = await db.replacePhoto(p.funda.id);
      const base = ['components', 'deckName', 'id', 'kind', 'lineTotalCents', 'name', 'photo', 'quantity', 'refundedQty', 'unitPriceCents'];
      const m3 = (await db.adminOrder(p.orderId)).body.accessoryLines as any[];
      expect(m3).toHaveLength(2);
      for (const l of m3) expect(Object.keys(l).sort()).toEqual([...base, 'deliveredRefund'].sort());
      const funda = m3.find((l) => l.kind === 'accessory');
      expect(funda).toMatchObject({ id: p.fundaLine!.orderAccessoryLineId, name: `Penny sleeves ${RUN}`, quantity: 2, unitPriceCents: 8900, lineTotalCents: 17800, refundedQty: 0, deckName: null, components: [] });
      expect(funda.photo.url).toBe(`/api/v1/accessories/${p.funda.id}/photo/${v2}/full`);
      const img = await h.api('GET', funda.photo.url.replace('/api/v1', ''));
      expect(img.status).toBe(200);
      const bundle = m3.find((l) => l.kind === 'energy_bundle');
      expect(bundle).toMatchObject({ photo: null, name: p.deck!.name, deckName: p.deck!.name, quantity: 1, unitPriceCents: 2000, lineTotalCents: 2000 });

      const prep = (await db.shipmentDetail(p.shipmentId)).body.accessoryLines.find((l: { kind: string }) => l.kind === 'accessory');
      expect(prep.photo.url).toContain(`/photo/${v2}/full`);

      const tr = await db.track(p.s.body.checkoutToken);
      expect(tr.status).toBe(200);
      const tl = tr.body.accessoryLines as any[];
      expect(tl).toHaveLength(2);
      for (const l of tl) expect(Object.keys(l).sort()).toEqual([...base].sort());
      expect(tl.find((l) => l.kind === 'accessory').photo.url).toContain(`/photo/${v2}/full`);
      const s = JSON.stringify(tr.body);
      for (const k of ['unitCostCents', 'snapshot', 'accessoryId', 'settledWithoutStock', 'deliveredRefund', 'stockQty']) expect(s).not.toContain(`"${k}"`);
    });
  });
});
