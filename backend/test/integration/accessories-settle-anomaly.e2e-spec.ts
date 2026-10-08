/**
 * 💰 v1.86.6 (API_CONTRACT §AC.21, ARCHITECTURE §4.AC (r)) — liquidar NUNCA cae por un renglón de accesorio (TD-AC-1),
 * contra Postgres REAL, por HTTP y webhook firmado. Propiedad: backend. BACKEND_NOTES §83.gates.
 *
 *  AC-B64 renglón `reserved` cuyo contador no lo respalda, CON existencias libres ⇒ recuperado (`settle_recovery`) +
 *         bitácora `order.settle_accessory_anomaly` · AC-B65 suelto SIN respaldo ⇒ `settledWithoutStock` + bitácora
 *         `order.settle_accessory_unbacked {was:'reserved'}` · AC-B66 paquete sin respaldo (todo o nada) con los dos
 *         órdenes de ids.
 *
 * Cada caso: pedido directo de invitado con 1 carta y el renglón, apartado por `session`; se rompe el contador a mano y
 * llega `payment_intent.succeeded`. Sin carrera ⇒ N=1 por caso (§AC.21.5).
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { AccDb } from './helpers/accessories-b-db';

const RUN = `acsa${Date.now().toString(36)}`;

describe('💰 §AC.21 — liquidar nunca cae por un accesorio (Postgres real)', () => {
  let h: E2EHarness;
  let db: AccDb;

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

  const audits = (orderId: string, action: string) => h.prisma.auditLog.findMany({ where: { entityId: orderId, action } });

  /** Lo común a los tres: pedido `settled`, carta `picking`, envío con su `ShipmentAccessoryLine`. */
  async function expectSettled(orderId: string, cardId: string, lineId: string) {
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('settled');
    expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: cardId } })).status).toBe('picking');
    const ship = await h.prisma.shipmentRequest.findFirstOrThrow({ where: { orderId } });
    const sal = await h.prisma.shipmentAccessoryLine.findMany({ where: { orderAccessoryLineId: lineId } });
    expect(sal).toHaveLength(1);
    expect(sal[0].shipmentRequestId).toBe(ship.id);
    return ship.id;
  }

  it('AC-B64 recuperado: Penny sleeves ×3, stock 10, reservedQty forzado a 0 ⇒ settle_recovery −3, stock 7, bitácora anomaly; reentrega idempotente', async () => {
    const a = await db.mkAccessory({ name: `Penny sleeves ${RUN} 64`, priceCents: 8900, stockQty: 10 });
    const card = await db.mkItem();
    const s = await db.session({ inventoryItemIds: [card.id], accessoryLines: [{ accessoryId: a.id, quantity: 3 }] });
    expect(s.status).toBe(201);
    await h.prisma.accessory.update({ where: { id: a.id }, data: { reservedQty: 0 } });
    await db.settle(s);
    const line = await h.prisma.orderAccessoryLine.findFirstOrThrow({ where: { orderId: s.body.orderId } });
    await expectSettled(s.body.orderId, card.id, line.id);
    expect(line).toMatchObject({ status: 'sold', settledWithoutStock: false });
    expect(await db.stockOf(a.id)).toEqual({ stockQty: 7, reservedQty: 0 });
    const mv = await h.prisma.accessoryStockMovement.findMany({ where: { accessoryId: a.id } });
    expect(mv.map((m) => ({ kind: m.kind, delta: m.delta, before: m.stockBefore, after: m.stockAfter }))).toEqual([{ kind: 'settle_recovery', delta: -3, before: 10, after: 7 }]);
    const au = await audits(s.body.orderId, 'order.settle_accessory_anomaly');
    expect(au.map((x) => x.after)).toEqual([{ lineId: line.id, accessoryId: a.id, quantity: 3, was: 'reserved', recovered: true }]);
    expect(await audits(s.body.orderId, 'order.settle_accessory_unbacked')).toHaveLength(0);

    await db.settle(s);
    expect(await h.prisma.accessoryStockMovement.count({ where: { accessoryId: a.id } })).toBe(1);
    expect(await audits(s.body.orderId, 'order.settle_accessory_anomaly')).toHaveLength(1);
    expect(await db.stockOf(a.id)).toEqual({ stockQty: 7, reservedQty: 0 });
  });

  it('AC-B65 sin respaldo, suelto: ×3 con stock 3 / reservedQty 2 forzados ⇒ settledWithoutStock, existencias intactas, 0 movimientos, bitácora unbacked was:reserved; la preparación lo marca', async () => {
    const a = await db.mkAccessory({ name: `Penny sleeves ${RUN} 65`, priceCents: 8900, stockQty: 10 });
    const card = await db.mkItem();
    const s = await db.session({ inventoryItemIds: [card.id], accessoryLines: [{ accessoryId: a.id, quantity: 3 }] });
    expect(s.status).toBe(201);
    await h.prisma.accessory.update({ where: { id: a.id }, data: { stockQty: 3, reservedQty: 2 } });
    await db.settle(s);
    const line = await h.prisma.orderAccessoryLine.findFirstOrThrow({ where: { orderId: s.body.orderId } });
    const shipmentId = await expectSettled(s.body.orderId, card.id, line.id);
    expect(line).toMatchObject({ status: 'sold', settledWithoutStock: true });
    expect(await db.stockOf(a.id)).toEqual({ stockQty: 3, reservedQty: 2 });
    expect(await h.prisma.accessoryStockMovement.count({ where: { accessoryId: a.id } })).toBe(0);
    const au = await audits(s.body.orderId, 'order.settle_accessory_unbacked');
    expect(au.map((x) => x.after)).toEqual([{ lineId: line.id, accessoryId: a.id, quantity: 3, was: 'reserved' }]);
    expect(await audits(s.body.orderId, 'order.settle_accessory_anomaly')).toHaveLength(0);
    const det = await db.shipmentDetail(shipmentId);
    expect(det.status).toBe(200);
    expect((det.body.accessoryLines as { id: string; settledWithoutStock: boolean }[]).map((l) => l.settledWithoutStock)).toEqual([true]);
  });

  describe('AC-B66 sin respaldo, paquete (todo o nada): 8 «Fuego» (contador sano) + 8 «Agua» (stock 8 / reservedQty 2 forzados)', () => {
    /**
     * «Fuego» y «Agua» son PAPELES (contador sano / contador roto), no tipos: los ids de la semilla no los elige la prueba,
     * así que se toman dos energías y se asignan los papeles según el orden de sus ids.
     *   (i)  el sano ordena ANTES que el roto ⇒ el sano se escribe por (a) y hay que DESHACERLO.
     *   (ii) el roto ordena ANTES que el sano ⇒ el sano no se alcanza y hay que SOLTAR su apartado.
     */
    const NAME = { fire: 'Basic Fire Energy', water: 'Basic Water Energy' } as const;
    async function scenario(healthyFirst: boolean) {
      const ids = { fire: db.energy.fire, water: db.energy.water };
      const lo = ids.fire < ids.water ? 'fire' : 'water';
      const hi = lo === 'fire' ? 'water' : 'fire';
      const healthy = healthyFirst ? lo : hi;
      const broken = healthyFirst ? hi : lo;
      expect(ids[healthy] < ids[broken]).toBe(healthyFirst);
      await db.setEnergy(healthy, { stockQty: 40 });
      await db.setEnergy(broken, { stockQty: 8 });
      const card = await db.mkItem();
      const deck = await db.mkDeck({ cards: 2, energies: [{ rawName: NAME[healthy], quantity: 8 }, { rawName: NAME[broken], quantity: 8 }] });
      const s = await db.session({ inventoryItemIds: [card.id], deckPulls: [{ pullToken: db.token(deck, [card.id]), withEnergyBundle: true }] });
      expect(s.status).toBe(201);
      expect(await db.stockOf(ids[healthy])).toEqual({ stockQty: 40, reservedQty: 8 });
      expect(await db.stockOf(ids[broken])).toEqual({ stockQty: 8, reservedQty: 8 });
      await h.prisma.accessory.update({ where: { id: ids[broken] }, data: { stockQty: 8, reservedQty: 2 } });
      const mv0 = await h.prisma.accessoryStockMovement.count({ where: { orderId: s.body.orderId } });
      await db.settle(s);
      const line = await h.prisma.orderAccessoryLine.findFirstOrThrow({ where: { orderId: s.body.orderId } });
      await expectSettled(s.body.orderId, card.id, line.id);
      expect(line).toMatchObject({ kind: 'energy_bundle', status: 'sold', settledWithoutStock: true });
      expect({ healthy: await db.stockOf(ids[healthy]), broken: await db.stockOf(ids[broken]) }).toEqual({
        healthy: { stockQty: 40, reservedQty: 0 },
        broken: { stockQty: 8, reservedQty: 2 },
      });
      expect(await h.prisma.accessoryStockMovement.count({ where: { orderId: s.body.orderId } })).toBe(mv0);
      const au = await audits(s.body.orderId, 'order.settle_accessory_unbacked');
      expect(au.map((x) => x.after)).toEqual([{ lineId: line.id, accessoryId: null, quantity: 1, was: 'reserved' }]);
    }

    it('(i) «Fuego» (sano) ordena antes que «Agua» (roto)', () => scenario(true));
    it('(ii) «Agua» (roto) ordena antes que «Fuego» (sano)', () => scenario(false));
  });
});
