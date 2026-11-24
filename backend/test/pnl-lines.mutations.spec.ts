/**
 * pnl-lines.mutations.spec.ts — 💰 §REPORTES-CEO F2b, gate de qa I-1: casos a mano (cada uno con su cifra calculada en centavos)
 * que matan las mutaciones que sobrevivieron a la propiedad aleatoria de `pnl-lines.spec.ts`. Cada `it` nombra la mutación que mata.
 * BD simulada mínima; el dinero se asierta línea por línea (no solo la suma).
 */
import { columnOf, pnlLinesBuckets, zeroAcc, zeroLineSet, LineSet } from '../src/modules/admin/pnl-lines';
import { ReportsFinanceService } from '../src/modules/admin/reports-finance.service';

type Row = Record<string, any>;
interface World {
  orders?: Row[];
  allOrders?: Row[];
  items?: Row[];
  shipments?: Row[];
  adjustments?: Row[];
  stripeRefunds?: Row[];
  speiRefunds?: Row[];
  paid?: Row[];
  inbound?: Row[];
  manual?: Row[];
}
const inRange = (d: Date | null, f: any) => !f || (d != null && (!f.gte || d >= f.gte) && (!f.lt || d < f.lt));

function fakeDb(w: World): any {
  const byId = (rows: Row[], where: any) => rows.filter((r) => where.id.in.includes(r.id));
  return {
    configSetting: { findMany: async () => [], findUnique: async () => null },
    order: {
      findMany: async (a: any) => {
        if (a.where?.id?.in) return byId(w.allOrders ?? w.orders ?? [], a.where);
        if (a.where?.status === 'chargeback') return [];
        return w.orders ?? [];
      },
      aggregate: async () => ({ _min: { settledAt: new Date('2020-01-15T12:00:00Z') } }),
    },
    orderItem: { findMany: async (a: any) => byId(w.items ?? [], a.where) },
    shipmentRequest: {
      findMany: async (a: any) => {
        if (a.where?.id?.in) return byId(w.shipments ?? [], a.where).map((s) => ({ id: s.id, orderId: s.orderId }));
        if (a.where?.kind === 'buylist_inbound') return w.inbound ?? [];
        return w.shipments ?? [];
      },
    },
    shipmentCostAdjustment: { findMany: async () => w.adjustments ?? [] },
    paymentRefund: { findMany: async () => w.stripeRefunds ?? [] },
    manualRefund: { findMany: async () => w.speiRefunds ?? [] },
    sellRequest: {
      findMany: async (a: any) => {
        if (a.where?.status === 'pagada') return (w.paid ?? []).filter((r) => inRange(r.paidAt, a.where.paidAt));
        if (a.where?.guideActualCostCents) return w.manual ?? [];
        return [];
      },
    },
    inventoryMovement: { findMany: async () => [] },
  };
}

const AT = new Date('2026-03-10T18:00:00Z');
const item = (id: string, type: string, price: number, disc = 0, cost: number | null = 0): Row => ({
  id,
  unitPriceCents: price,
  unitDiscountCents: disc,
  inventoryItem: { productType: type, acquisitionCostCents: cost, acquisitionCostIvaCents: 0 },
});
const acc = (id: string, qty: number, price: number, disc = 0): Row => ({
  id, kind: 'accessory', status: 'sold', quantity: qty, unitPriceCents: price, unitDiscountCents: disc, unitCostCents: 0, shipmentLine: null, components: [],
});
function order(over: Row): Row {
  const items: Row[] = over.items ?? [];
  const accessoryLines: Row[] = over.accessoryLines ?? [];
  const subtotalCents = items.reduce((s, x) => s + x.unitPriceCents, 0) + accessoryLines.reduce((s, x) => s + x.unitPriceCents * x.quantity, 0);
  return {
    id: 'o1', status: 'settled', settledAt: AT, subtotalCents, discountCents: 0, ivaCents: 0, ivaRatePct: 16, priceConvention: 'IVA_EXCLUSIVE',
    feeConvention: 'FEE_ON_TOP', stripeFeeCents: null, processingFeeCents: 0, totalCents: subtotalCents, stripePaymentIntentId: 'pi', fulfillmentMode: 'vault', shippingFeeCents: 0,
    items, accessoryLines, ...over,
  };
}
const worldOf = (orders: Row[], rest: World = {}): World => ({
  orders, allOrders: orders, items: orders.flatMap((o) => o.items), ...rest,
});
const run = async (w: World, opts: Parameters<typeof pnlLinesBuckets>[3] = {}): Promise<LineSet> =>
  (await pnlLinesBuckets(fakeDb(w), undefined, () => 'all', opts)).get('all') ?? zeroLineSet();
const shipment = (over: Row): Row => ({
  id: 's1', orderId: null, pickingAt: AT, priceConvention: 'IVA_EXCLUSIVE', shippingFeeCents: 0, ivaCents: 0, shippingCostCents: 0, shippingCostIvaCents: 0,
  insuranceCostCents: 0, labelSource: 'skydropx', feeConvention: 'FEE_ON_TOP', stripeFeeCents: null, processingFeeCents: 0, totalCents: 0, stripePaymentIntentId: null, ...over,
});
const refund = (over: Row): Row => ({
  amountCents: 0, merchandiseCents: 0, merchandiseIvaCents: 0, shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 0, compensationCents: 0, submittedAt: AT,
  orderId: null, orderItemId: null, orderAccessoryLineId: null, shipmentRequestId: null, ...over,
});

describe('pnl-lines: mutaciones de I-1 (casos a mano)', () => {
  it('descuento: con pesos de descuento se reparte POR DESCUENTO, no por lo cobrado (pnl-lines :278) — 100/0 y no 50/50; sin pesos cae a lo cobrado', async () => {
    const o = order({ discountCents: 100, items: [item('a', 'raw', 1000, 100), item('b', 'sealed', 1000, 0)] });
    const s = await run(worldOf([o]));
    expect(s.raw.discountsCents).toBe(100);
    expect(s.sealed.discountsCents).toBe(0);
    expect(s.raw.grossSalesCents).toBe(1100); // neto 1000·... : net(2000) 1000/1000 + descuento ⇒ raw 1000+100
    expect(s.sealed.grossSalesCents).toBe(1000);
    // sin pesos de descuento ⇒ por lo cobrado (2000 de descuento sobre 3000/1000 ⇒ 1500/500)
    const o2 = order({ discountCents: 2000, items: [item('a', 'raw', 3000), item('b', 'sealed', 1000)] });
    const s2 = await run(worldOf([o2]));
    expect(s2.raw.discountsCents).toBe(1500);
    expect(s2.sealed.discountsCents).toBe(500);
  });

  it('descuento de accesorio pesa por unidad × cantidad (pnl-lines :148) — 100/300 y no 200/200', async () => {
    const o = order({ discountCents: 400, items: [item('a', 'sealed', 1000, 100)], accessoryLines: [acc('x', 3, 500, 100)] });
    const s = await run(worldOf([o]));
    expect(s.sealed.discountsCents).toBe(100);
    expect(s.accessory.discountsCents).toBe(300);
  });

  it('IVA incluido: el descuento se reparte SIN IVA (pnl-lines :271) — 116 con IVA ⇒ 100 netos', async () => {
    const o = order({ priceConvention: 'IVA_INCLUSIVE', discountCents: 116, items: [item('a', 'raw', 1160, 116)] });
    // subtotal 1160 incl. IVA ⇒ ingreso neto 1000; descuento 116 con IVA ⇒ 100 neto
    const s = await run(worldOf([o]));
    expect(s.raw.discountsCents).toBe(100);
    expect(s.raw.grossSalesCents).toBe(1100);
  });

  it('envío cobrado del pedido directo va a las líneas de SUS piezas, no a «Sin línea» (pnl-lines :289)', async () => {
    const o = order({ fulfillmentMode: 'direct_ship', shippingFeeCents: 500, items: [item('a', 'raw', 1000)] });
    const s = await run(worldOf([o]));
    expect(s.raw.shippingResultCents).toBe(500);
    expect(s.unassigned.shippingResultCents).toBe(0);
  });

  it('envío con pedido (ingreso, costo y comisión) cae en las líneas del pedido; el ajuste de guía también (pnl-lines :301, :304, :309)', async () => {
    const o = order({ items: [item('a', 'raw', 1000)] });
    const w = worldOf([o], {
      shipments: [shipment({ id: 's1', orderId: 'o1', shippingFeeCents: 400, shippingCostCents: 100, processingFeeCents: 50 })],
      adjustments: [{ amountCents: 200, ivaCents: 20, chargedAt: AT, shipmentRequest: { orderId: 'o1' } }],
    });
    const s = await run(w);
    expect(s.raw.shippingResultCents).toBe(400 - 100 - 180); // 120
    expect(s.raw.paymentFeeCents).toBe(50);
    expect(s.unassigned.shippingResultCents).toBe(0);
    expect(s.unassigned.paymentFeeCents).toBe(0);
  });

  it('reembolso de pedido completo reparte por las partidas del pedido; el de un cobro de retiro hereda el pedido del retiro (pnl-lines :325)', async () => {
    const o = order({ items: [item('a', 'raw', 1000)] });
    const w = worldOf([o], {
      shipments: [shipment({ id: 's1', orderId: 'o1' })],
      stripeRefunds: [
        refund({ orderId: 'o1', merchandiseCents: 1000, shippingCents: 200 }),
        refund({ shipmentRequestId: 's1', merchandiseCents: 300, shippingCents: 100 }),
      ],
    });
    const s = await run(w);
    expect(s.raw.refundsCents).toBe(1300);
    expect(s.raw.shippingResultCents).toBe(-300);
    expect(s.unassigned.refundsCents).toBe(0);
    expect(s.unassigned.shippingResultCents).toBe(0);
    // Un reembolso sin pedido ni retiro sí es «Sin línea»
    const s2 = await run(worldOf([o], { stripeRefunds: [refund({ merchandiseCents: 70 })] }));
    expect(s2.unassigned.refundsCents).toBe(70);
  });

  it('el reembolso SPEI sustituto de un Stripe fallido hereda la línea del original (pieza y orden)', async () => {
    const o = order({ items: [item('i-sealed', 'sealed', 600), item('i-raw', 'raw', 400)] });
    const w = worldOf([o], {
      speiRefunds: [
        // sustituta de un reembolso Stripe por UNA pieza: va a esa línea, no a la otra ni a «Sin línea»
        { amountCents: 600, merchandiseCents: 600, merchandiseIvaCents: 0, processingFeeCents: 0, compensationCents: 0, paidAt: AT, orderId: null,
          paymentRefund: { orderId: 'o1', orderItemId: 'i-sealed', orderAccessoryLineId: null, shipmentRequestId: null } },
        // sustituta de uno del PEDIDO completo: se reparte 600/400 (200 → 120/80)
        { amountCents: 200, merchandiseCents: 200, merchandiseIvaCents: 0, processingFeeCents: 0, compensationCents: 0, paidAt: AT, orderId: null,
          paymentRefund: { orderId: 'o1', orderItemId: null, orderAccessoryLineId: null, shipmentRequestId: null } },
      ],
    });
    const s = await run(w);
    expect(s.sealed.refundsCents).toBe(600 + 120);
    expect(s.raw.refundsCents).toBe(80);
    expect(s.unassigned.refundsCents).toBe(0);
  });

  it('guía manual: la de una solicitud con guía de Skydropx no se cuenta dos veces (pnl-lines :339); la de Skydropx entra por su vía', async () => {
    const w: World = {
      ...worldOf([]),
      inbound: [{ labelPurchasedAt: AT, labelSource: 'skydropx', providerCancelConfirmedAt: null, shippingCostCents: 100, shippingCostIvaCents: 0 }],
      manual: [
        { guideActualCostCents: 700, guideSentAt: AT, shipmentConfirmedAt: null, inboundShipment: { labelSource: 'skydropx' } },
        { guideActualCostCents: 300, guideSentAt: AT, shipmentConfirmedAt: null, inboundShipment: null },
      ],
    };
    const memo = { insuranceCents: 0, adjustmentsCents: 0, retainedFeeCents: 0, guideCostCents: 0 };
    const s = await run(w, { memo });
    expect(s.unassigned.shippingResultCents).toBe(-400);
    expect(memo.guideCostCents).toBe(400);
  });

  it('margen: null con ventas netas 0 o NEGATIVAS (pnl-lines :97); con ventas netas positivas se calcula', () => {
    const col = (gross: number, refunds: number, cogs = 0) => columnOf({ ...zeroAcc(), grossSalesCents: gross, refundsCents: refunds, cogsCents: cogs });
    expect(col(0, 1000).netSalesCents).toBe(-1000);
    expect(col(0, 1000).marginBps).toBeNull();
    expect(col(1000, 1000).marginBps).toBeNull();
    expect(col(1000, 0, 250).marginBps).toBe(7500);
  });

  it('costMissingCount cuenta las piezas vendidas sin costo (pnl-lines :292) y no las que sí lo tienen', async () => {
    const o = order({ items: [item('a', 'raw', 1000, 0, null), item('b', 'raw', 1000, 0, 400), item('c', 'sealed', 1000, 0, null)] });
    const counters = { costMissingCount: 0, allocationMismatchOrders: 0 };
    const s = await run(worldOf([o]), { counters });
    expect(counters.costMissingCount).toBe(2);
    expect(counters.allocationMismatchOrders).toBe(0);
    expect(s.raw.cogsCents).toBe(400); // el nulo cuenta 0
    await expect(run(worldOf([o]))).resolves.toBeDefined(); // sin contador no revienta
  });
});

describe('ReportsFinanceService: mutaciones de I-1 (series y report con BD simulada)', () => {
  const NOW = new Date('2026-11-24T18:00:00Z');
  const svc = (w: World) => {
    const admin: any = { ivaReport: async () => ({ ivaCollectedCents: 0, ivaRefundedCents: 0, ivaNetCents: 0 }) };
    return new ReportsFinanceService(fakeDb(w), admin);
  };
  const settled = (id: string, at: string, items: Row[]) => order({ id, settledAt: new Date(at), items });

  it('series mensual: el ÚLTIMO día de cada tramo cuenta (sumRange inclusivo, :251), el tramo anterior es el mes anterior (:257) y byLine compara cada línea con SU anterior (:102)', async () => {
    // asOf 2026-11-24, count 1 ⇒ octubre 1..31 (anterior sep 1..30) y noviembre 1..24 (anterior oct 1..24)
    const orders = [
      settled('sep30', '2026-09-30T18:00:00Z', [item('p1', 'raw', 1000), item('p2', 'sealed', 2000)]), // último día del tramo anterior de octubre
      settled('oct31', '2026-10-31T18:00:00Z', [item('p3', 'raw', 5000)]), // último día de octubre
      settled('nov24', '2026-11-24T18:00:00Z', [item('p4', 'graded', 7000)]), // asOf: último día del cubo en curso
    ];
    const r: any = await svc(worldOf(orders)).series({ groupBy: 'month', count: 1, asOf: '2026-11-24' }, NOW);
    const [oct, nov] = r.buckets;
    expect([oct.from, oct.to, nov.from, nov.to]).toEqual(['2026-10-01', '2026-10-31', '2026-11-01', '2026-11-24']);
    expect(oct.total.grossSalesCents).toBe(5000);
    expect(nov.total.grossSalesCents).toBe(7000);
    // tramo anterior de octubre = septiembre (3000 en dos líneas), no octubre mismo
    expect(oct.comparison.total.grossSalesCents).toMatchObject({ cents: 5000, previousCents: 3000, deltaCents: 2000 });
    expect(oct.comparison.byLine.raw.grossSalesCents).toMatchObject({ cents: 5000, previousCents: 1000 });
    expect(oct.comparison.byLine.sealed.grossSalesCents).toMatchObject({ cents: 0, previousCents: 2000 });
    expect(oct.comparison.byLine.graded.grossSalesCents.previousCents).toBe(0);
    // noviembre: anterior = octubre 1..24 ⇒ el pedido del 31 NO entra
    expect(nov.comparison.total.grossSalesCents.previousCents).toBe(0);
  });

  it('report con rango: las compras de inventario (memo) solo suman las pagadas DENTRO del periodo (:140)', async () => {
    const paid = (at: string, payout: number) => ({ paidAt: new Date(at), approvedTotalCents: payout, offerGrossCents: null, quotedTotalCents: null, payoutNetCents: payout, guideSentAt: null, guideActualCostCents: null, inboundShipment: null });
    const w = worldOf([], { paid: [paid('2026-03-10T18:00:00Z', 5000), paid('2026-01-10T18:00:00Z', 7000)] });
    const ranged: any = await svc(w).report({ from: '2026-03-01', to: '2026-03-31' });
    expect(ranged.memo.inventoryPurchasesCents).toBe(5000);
    const all: any = await svc(w).report({});
    expect(all.memo.inventoryPurchasesCents).toBe(12000);
  });
});
