/**
 * 💰 AC-B26 (criterio 723) — P&L: el ingreso incluye accesorios y paquete (ya sale de `subtotalCents`); el costo de venta
 * usa el costo CONGELADO: `Σ unitCostCents × (quantity − missingQty)` de renglones `sold` y, en paquetes,
 * `Σ componente.unitCostCents × quantity`; `null ⇒ 0`; `restocked` no cuenta (§AC.12).
 * AC-B27 — Analítica: `mix.byProductType.accessory` (unidades + 1 por paquete) y Σ celdas = totales.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { AccDb, FUNDA_DIMS } from './helpers/accessories-b-db';
import { pnlBuckets } from '../../src/modules/admin/pnl-core';
import { netRevenueCents } from '../../src/common/money';
import { SalesAnalyticsService } from '../../src/modules/sales-analytics/sales-analytics.service';
import { todayMx } from '../../src/modules/sales-analytics/sales-period';

const RUN = `acbn${Date.now().toString(36)}`;

describe('💰 Accesorios (B) — P&L y analítica (Postgres real)', () => {
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

  /** El cubo de UNA orden: el rango exacto de su `settledAt`. */
  async function pnlOf(orderId: string) {
    const o = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const others = await h.prisma.order.count({ where: { settledAt: o.settledAt, status: 'settled', id: { not: orderId } } });
    expect(others).toBe(0);
    const m = await pnlBuckets(h.prisma, { gte: o.settledAt!, lte: o.settledAt! }, () => 'k');
    return { o, b: m.get('k')! };
  }

  async function bundleOrder() {
    await db.setEnergy('fire', { stockQty: 40, unitCostCents: 200 });
    await db.setEnergy('psychic', { stockQty: 40, unitCostCents: null });
    const funda = await db.mkAccessory({ priceCents: 8900, stockQty: 20, unitCostCents: 3000, dims: FUNDA_DIMS });
    const c1 = await db.mkItem({ listPriceCents: 30000 });
    const c2 = await db.mkItem({ listPriceCents: 30000 });
    const deck = await db.mkDeck({ cards: 2, energies: [{ rawName: 'Basic Fire Energy', quantity: 8 }, { rawName: 'Basic Psychic Energy', quantity: 4 }] });
    const p = await db.paidOrder({
      inventoryItemIds: [c1.id, c2.id],
      accessoryLines: [{ accessoryId: funda.id, quantity: 3 }],
      deckPulls: [{ pullToken: db.token(deck, [c1.id, c2.id]), withEnergyBundle: true }],
    });
    return { ...p, funda, cards: [c1, c2] };
  }

  it('AC-B26: ingreso incluye accesorios; costo = cartas + 3 × 3000 + 8 × 200 (+ 4 × null ⇒ 0); el paquete NO dos veces', async () => {
    const p = await bundleOrder();
    const { o, b } = await pnlOf(p.orderId);
    expect(b.incomeCents).toBe(netRevenueCents(o));
    expect(o.subtotalCents).toBe(2 * (await h.prisma.orderItem.findFirstOrThrow({ where: { orderId: o.id } })).unitPriceCents + 3 * 8900 + 2000);
    expect(b.cogsCents).toBe(2 * 70000 + 3 * 3000 + 8 * 200);
  });

  it('AC-B26: faltante al preparar ⇒ (quantity − missingQty); paquete faltante entero ⇒ 0', async () => {
    const p = await bundleOrder();
    const sal = await h.prisma.shipmentAccessoryLine.findMany({ where: { shipmentRequestId: p.shipmentId }, include: { orderAccessoryLine: true } });
    for (const l of sal) {
      const missingQty = l.orderAccessoryLine.kind === 'accessory' ? 1 : 1;
      await h.prisma.shipmentAccessoryLine.update({ where: { id: l.id }, data: { prepStatus: 'missing', missingQty, missingReason: 'not_found' } });
    }
    const { b } = await pnlOf(p.orderId);
    expect(b.cogsCents).toBe(2 * 70000 + 2 * 3000 + 0);
  });

  it('AC-B26: renglón restocked ⇒ no cuenta costo', async () => {
    const p = await bundleOrder();
    const lines = await h.prisma.orderAccessoryLine.findMany({ where: { orderId: p.orderId } });
    const funda = lines.find((l) => l.kind === 'accessory')!;
    await h.prisma.orderAccessoryLine.update({ where: { id: funda.id }, data: { status: 'restocked', restockedAt: new Date() } });
    const { b } = await pnlOf(p.orderId);
    expect(b.cogsCents).toBe(2 * 70000 + 8 * 200);
  });

  it('AC-B27: byProductType.accessory = unidades + 1 por paquete; Σ celdas = totales; totals.pieces incluye esas unidades', async () => {
    const svc = h.app.get(SalesAnalyticsService);
    const day = todayMx(new Date());
    const before = await svc.report({ from: day, to: day }, new Date());
    const p = await bundleOrder();
    const after = await svc.report({ from: day, to: day }, new Date());
    const cells = (r: typeof after) => Object.values(r.mix.byProductType) as { pieces: number; netCents: number }[];
    const acc = (r: typeof before) => (r.mix.byProductType as Record<string, { pieces: number; netCents: number }>).accessory ?? { pieces: 0, netCents: 0 };
    expect(acc(after).pieces - acc(before).pieces).toBe(3 + 1);
    expect(after.totals.pieces - before.totals.pieces).toBe(2 + 3 + 1);
    expect(cells(after).reduce((a, c) => a + c.pieces, 0)).toBe(after.totals.pieces);
    expect(cells(after).reduce((a, c) => a + c.netCents, 0)).toBe(after.totals.netSalesCents);
    expect(Object.keys(after.mix.byProductType).sort()).toEqual(['accessory', 'graded', 'raw', 'sealed']);
    expect(p.orderId).toEqual(expect.any(String));
  });
});
