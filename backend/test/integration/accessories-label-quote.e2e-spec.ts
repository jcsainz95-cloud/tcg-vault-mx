/**
 * 💰 AC-B17 (criterio 714) — el valor asegurado de la guía suma lo pagado por accesorios y paquete: `insuredValueOf`,
 * rama `guest_direct_ship`, + Σ (quantity − missingQty) × unitPriceCents de cada `ShipmentAccessoryLine` `picked|missing`
 * (el paquete entra entero o nada). Y la segunda mitad de AC-B46: cotizar la guía con OTRA caja no toca lo cobrado.
 * Proveedor DOBLE (⛔ nunca la red, PS-99), pedidos creados por HTTP real.
 */
import { E2EHarness } from './helpers/e2e-app';
import { createLabelWorld, providerOn, READY_ADDRESS, restoreDials } from './helpers/label-db';
import { AccDb, FUNDA_DIMS, HUGE_DIMS } from './helpers/accessories-b-db';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { ManualLabelClock } from '../../src/modules/shipments/label-clock';
import { ShipPrepDb } from './helpers/ship-prep-db';

const RUN = `acbl${Date.now().toString(36)}`;

describe('💰 Accesorios (B) — seguro de la guía y caja al preparar (Postgres real, proveedor doble)', () => {
  let h: E2EHarness;
  let world: ShipPrepDb;
  let fake: FakeShippingProvider;
  let clock: ManualLabelClock;
  let db: AccDb;

  beforeAll(async () => {
    ({ h, db: world, fake, clock } = await createLabelWorld(RUN));
    await providerOn(h);
    db = new AccDb(h, RUN);
    await db.init();
  });

  afterAll(async () => {
    await restoreDials(h);
    await db?.cleanup();
    await world?.cleanup();
    await h?.close();
  });

  const quote = (id: string, json: unknown = {}) => {
    clock.advance(1);
    return h.api('POST', `/admin/shipments/${id}/quote`, { token: db.opToken, json });
  };

  /** Palomea todo salvo lo indicado, marca faltantes y prepara; deja la dirección completa. */
  async function prepared(shipmentId: string, missing: { salId: string; qty: number }[] = []) {
    const items = await h.prisma.shipmentItem.findMany({ where: { shipmentRequestId: shipmentId } });
    for (const it of items) expect((await db.markCard(shipmentId, it.id, { status: 'picked' })).status).toBe(200);
    const acc = await h.prisma.shipmentAccessoryLine.findMany({ where: { shipmentRequestId: shipmentId } });
    let preview = 0;
    for (const l of acc) {
      const m = missing.find((x) => x.salId === l.id);
      const r = await db.markAcc(shipmentId, l.id, m ? { status: 'missing', missingQty: m.qty, missingReason: 'not_found' } : { status: 'picked' });
      expect(r.status).toBe(200);
      preview = r.body.preparation.refundPreviewCents;
    }
    expect((await db.prepare(shipmentId, preview)).status).toBe(200);
    await h.prisma.shipmentRequest.update({ where: { id: shipmentId }, data: { addressSnapshot: READY_ADDRESS } });
  }

  it('AC-B17: carta + funda ×3 (1 faltante) + paquete ⇒ asegurado = carta + 2 × funda + paquete', async () => {
    await db.setEnergy('fire', { stockQty: 40 });
    const funda = await db.mkAccessory({ priceCents: 8900, stockQty: 20, dims: FUNDA_DIMS });
    const card = await db.mkItem({ listPriceCents: 30000 });
    const card2 = await db.mkItem({ listPriceCents: 30000 });
    const deck = await db.mkDeck({ cards: 2, energies: [{ rawName: 'Basic Fire Energy', quantity: 8 }] });
    const p = await db.paidOrder({
      inventoryItemIds: [card.id, card2.id],
      accessoryLines: [{ accessoryId: funda.id, quantity: 3 }],
      deckPulls: [{ pullToken: db.token(deck, [card.id, card2.id]), withEnergyBundle: true }],
    });
    const sal = await h.prisma.shipmentAccessoryLine.findMany({ where: { shipmentRequestId: p.shipmentId }, include: { orderAccessoryLine: true } });
    const fundaSal = sal.find((l) => l.orderAccessoryLine.kind === 'accessory')!;
    await prepared(p.shipmentId, [{ salId: fundaSal.id, qty: 1 }]);
    const ois = await h.prisma.orderItem.findMany({ where: { orderId: p.orderId } });
    const r = await quote(p.shipmentId);
    expect(r.status).toBe(200);
    expect(r.body.insurance.insuredValueCents).toBe(ois.reduce((a, o) => a + o.unitPriceCents, 0) + 2 * 8900 + 2000);
  });

  it('AC-B17: directo SIN accesorios ⇒ asegurado = Σ cartas, como hoy (I-AC-5)', async () => {
    const card = await db.mkItem({ listPriceCents: 30000 });
    const p = await db.paidOrder({ inventoryItemIds: [card.id] });
    await prepared(p.shipmentId);
    const oi = await h.prisma.orderItem.findFirstOrThrow({ where: { orderId: p.orderId } });
    const r = await quote(p.shipmentId);
    expect(r.status).toBe(200);
    expect(r.body.insurance.insuredValueCents).toBe(oi.unitPriceCents);
  });

  it('AC-B46: review = true no retiene la guía; cotizar con otra caja ⛔ cambia Order.totalCents ni crea cargo', async () => {
    const big = await db.mkAccessory({ priceCents: 30000, stockQty: 5, dims: HUGE_DIMS, category: 'deck_boxes' });
    await db.setBoxes([{ code: 'grande', l: 70, w: 40, h: 10, fee: db.eBase + 9700 }]);
    const p = await db.paidOrder({ accessoryLines: [{ accessoryId: big.id, quantity: 3 }] });
    const before = await h.prisma.order.findUniqueOrThrow({ where: { id: p.orderId } });
    expect(before.shippingBoxReview).toBe(true);
    await prepared(p.shipmentId);
    const pis = h.stripe.createdIntents.length;
    const r = await quote(p.shipmentId, { packageCode: 'box' });
    expect(r.status).toBe(200);
    expect(r.body.insurance.insuredValueCents).toBe(3 * 30000);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: p.orderId } })).totalCents).toBe(before.totalCents);
    expect(h.stripe.createdIntents.length).toBe(pis);
    expect(fake.callsOf('quote').length).toBeGreaterThan(0);
  });
});
