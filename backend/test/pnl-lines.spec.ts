/**
 * pnl-lines.spec.ts — 💰 §REPORTES-CEO F2b: el P&L por línea contra el P&L plano, con una BD simulada y datos ALEATORIOS.
 * Propiedad: para cada escenario (pedidos mixtos, descuentos, con/sin IVA incluido, comisión real/ON_TOP, envíos de pedido y de
 * bóveda, ajustes, reembolsos por pieza/renglón/pedido/retiro, buylist) `Σ(5 líneas).contributionCents == profitCents` de
 * `pnlBuckets`, y las partes (ingreso, costo, comisión) cuadran al centavo con el plano. Más un caso calculado a mano.
 */
import { pnlBuckets, zeroPnl } from '../src/modules/admin/pnl-core';
import { columnOf, pnlLinesBuckets, totalOf, zeroLineSet } from '../src/modules/admin/pnl-lines';

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Row = Record<string, any>;
interface World {
  allOrders?: Row[];
  orders: Row[];
  shipments: Row[];
  adjustments: Row[];
  stripeRefunds: Row[];
  speiRefunds: Row[];
  paidSell: Row[];
  items: Row[]; // OrderItem sueltos (de pedidos ya cargados o no)
}

function fakeDb(w: World): any {
  const byIdIn = (rows: Row[], where: any) => rows.filter((r) => where.id.in.includes(r.id));
  return {
    configSetting: { findMany: async () => [] },
    order: {
      findMany: async (a: any) => {
        if (a.where?.id?.in) return byIdIn(w.allOrders ?? w.orders, a.where);
        // Prisma aplica el `where` del include: el plano pide solo los renglones `sold`; el reparto pide todos (pesos).
        const only = a.include?.accessoryLines?.where?.status;
        return only ? w.orders.map((o) => ({ ...o, accessoryLines: o.accessoryLines.filter((l: Row) => l.status === only) })) : w.orders;
      },
    },
    orderItem: {
      findMany: async (a: any) => byIdIn(w.items, a.where),
    },
    shipmentRequest: {
      findMany: async (a: any) => {
        if (a.where?.id?.in) return byIdIn(w.shipments, a.where).map((s) => ({ id: s.id, orderId: s.orderId }));
        if (a.where?.kind === 'buylist_inbound') return [];
        return w.shipments;
      },
    },
    shipmentCostAdjustment: { findMany: async () => w.adjustments },
    paymentRefund: { findMany: async () => w.stripeRefunds },
    manualRefund: { findMany: async () => w.speiRefunds },
    sellRequest: {
      findMany: async (a: any) => (a.where?.status === 'pagada' ? w.paidSell : []),
    },
  };
}

const TYPES = ['sealed', 'raw', 'graded'] as const;

function genWorld(r: () => number, tag: string): World & { allOrders: Row[] } {
  const int = (n: number) => Math.floor(r() * n);
  const pick = <T,>(xs: readonly T[]) => xs[int(xs.length)];
  const world: World & { allOrders: Row[] } = { orders: [], allOrders: [], shipments: [], adjustments: [], stripeRefunds: [], speiRefunds: [], paidSell: [], items: [] };
  const at = new Date('2026-03-10T18:00:00Z');
  const nOrders = 1 + int(5);
  for (let i = 0; i < nOrders; i++) {
    const id = `${tag}-o${i}`;
    const items: Row[] = [];
    for (let k = 0; k < int(4); k++) {
      const it = {
        id: `${id}-i${k}`,
        unitPriceCents: 100 + int(500_000),
        unitDiscountCents: r() < 0.4 ? int(5000) : 0,
        inventoryItem: { productType: pick(TYPES), acquisitionCostCents: r() < 0.1 ? null : int(300_000), acquisitionCostIvaCents: r() < 0.3 ? int(2000) : 0 },
      };
      items.push(it);
      world.items.push(it);
    }
    const acc: Row[] = [];
    for (let k = 0; k < int(3); k++) {
      const bundle = r() < 0.3;
      acc.push({
        id: `${id}-a${k}`,
        kind: bundle ? 'energy_bundle' : 'accessory',
        status: pick(['sold', 'sold', 'sold', 'restocked', 'released']),
        quantity: 1 + int(4),
        unitPriceCents: 50 + int(20_000),
        unitDiscountCents: bundle ? 0 : r() < 0.4 ? int(500) : 0,
        unitCostCents: bundle ? null : int(10_000),
        shipmentLine: r() < 0.2 ? { missingQty: int(2) } : null,
        components: bundle ? [{ quantity: 1 + int(3), unitCostCents: int(300) }] : [],
      });
    }
    const cobrado = items.reduce((s, x) => s + x.unitPriceCents, 0) + acc.reduce((s, x) => s + x.unitPriceCents * x.quantity, 0);
    const incl = r() < 0.5;
    const subtotalCents = r() < 0.9 ? cobrado : cobrado + int(50); // a veces el pedido no cuadra (allocationMismatch)
    const direct = r() < 0.3;
    const shippingFeeCents = direct ? int(30_000) : 0;
    const o = {
      id,
      status: r() < 0.2 ? 'refunded' : 'settled',
      settledAt: at,
      subtotalCents,
      discountCents: r() < 0.5 ? int(8000) : 0,
      ivaCents: incl ? Math.round(((subtotalCents + shippingFeeCents) * 16) / 116) : Math.round(subtotalCents * 0.16),
      ivaRatePct: 16,
      priceConvention: incl ? 'IVA_INCLUSIVE' : 'IVA_EXCLUSIVE',
      feeConvention: r() < 0.5 ? 'FEE_INCLUDED' : 'FEE_ON_TOP',
      stripeFeeCents: r() < 0.7 ? int(20_000) : null,
      processingFeeCents: int(10_000),
      totalCents: subtotalCents + shippingFeeCents,
      stripePaymentIntentId: r() < 0.9 ? 'pi_x' : null,
      fulfillmentMode: direct ? 'direct_ship' : 'vault',
      shippingFeeCents,
      items,
      accessoryLines: acc,
    };
    world.orders.push(o);
    world.allOrders.push(o);
    // envío del pedido (fulfillment direct_ship o un retiro con orderId)
    if (r() < 0.5) {
      world.shipments.push(genShipment(r, `${id}-s`, id, at));
    }
    if (r() < 0.2) world.adjustments.push({ amountCents: 100 + int(5000), ivaCents: int(500), chargedAt: at, shipmentRequest: { orderId: id } });
    // reembolsos
    if (items.length && r() < 0.4) world.stripeRefunds.push(refund(r, at, { orderId: id, orderItemId: pick(items).id }));
    if (acc.length && r() < 0.3) world.stripeRefunds.push(refund(r, at, { orderId: id, orderAccessoryLineId: pick(acc).id }));
    if (r() < 0.3) world.stripeRefunds.push(refund(r, at, { orderId: id }));
    if (r() < 0.2) world.speiRefunds.push(spei(r, at, { orderId: id, paymentRefund: null }));
  }
  // pedido liquidado FUERA del rango leído (sus reembolsos/envíos igual se reparten por sus partidas)
  const outsider = { ...world.orders[0], id: `${tag}-out`, items: [{ id: `${tag}-out-i`, unitPriceCents: 9000, unitDiscountCents: 0, inventoryItem: { productType: 'graded', acquisitionCostCents: 1, acquisitionCostIvaCents: 0 } }], accessoryLines: [] };
  world.allOrders.push(outsider);
  world.items.push(outsider.items[0]);
  if (r() < 0.7) world.stripeRefunds.push(refund(r, at, { orderId: outsider.id }));
  // retiros de bóveda SIN pedido y reembolsos sin pedido
  for (let k = 0; k < int(3); k++) world.shipments.push(genShipment(r, `${tag}-v${k}`, null, at));
  if (r() < 0.5) world.stripeRefunds.push(refund(r, at, { shipmentRequestId: world.shipments[world.shipments.length - 1]?.id ?? null }));
  if (r() < 0.4) world.speiRefunds.push(spei(r, at, { orderId: null, paymentRefund: null }));
  if (r() < 0.4) world.speiRefunds.push(spei(r, at, { orderId: null, paymentRefund: { orderId: world.orders[0].id, orderItemId: world.orders[0].items[0]?.id ?? null, orderAccessoryLineId: null, shipmentRequestId: null } }));
  // buylist
  for (let k = 0; k < int(3); k++) {
    world.paidSell.push({ paidAt: at, approvedTotalCents: 20_000 + int(50_000), offerGrossCents: null, quotedTotalCents: null, payoutNetCents: r() < 0.9 ? int(20_000) : null, guideSentAt: r() < 0.5 ? at : null, guideActualCostCents: r() < 0.5 ? int(5000) : null, inboundShipment: null });
  }
  return world;
}

function genShipment(r: () => number, id: string, orderId: string | null, at: Date): Row {
  const int = (n: number) => Math.floor(r() * n);
  const incl = r() < 0.5;
  const fee = int(40_000);
  return {
    id,
    orderId,
    pickingAt: at,
    priceConvention: incl ? 'IVA_INCLUSIVE' : 'IVA_EXCLUSIVE',
    shippingFeeCents: fee,
    ivaCents: incl ? Math.round((fee * 16) / 116) : Math.round(fee * 0.16),
    shippingCostCents: int(30_000),
    shippingCostIvaCents: int(4000),
    insuranceCostCents: int(500),
    labelSource: 'skydropx',
    feeConvention: r() < 0.5 ? 'FEE_INCLUDED' : 'FEE_ON_TOP',
    stripeFeeCents: r() < 0.7 ? int(3000) : null,
    processingFeeCents: int(1000),
    totalCents: fee,
    stripePaymentIntentId: r() < 0.9 ? 'pi_s' : null,
  };
}
function refund(r: () => number, at: Date, link: Row): Row {
  const int = (n: number) => Math.floor(r() * n);
  const m = int(100_000);
  const s = r() < 0.5 ? int(20_000) : 0;
  return {
    amountCents: m + s,
    merchandiseCents: m,
    merchandiseIvaCents: Math.round((m * 16) / 116),
    shippingCents: s,
    shippingIvaCents: Math.round((s * 16) / 116),
    processingFeeCents: r() < 0.3 ? int(3000) : 0,
    compensationCents: r() < 0.2 ? int(5000) : 0,
    submittedAt: at,
    orderId: null,
    orderItemId: null,
    orderAccessoryLineId: null,
    shipmentRequestId: null,
    ...link,
  };
}
function spei(r: () => number, at: Date, link: Row): Row {
  const int = (n: number) => Math.floor(r() * n);
  const m = int(100_000);
  return { amountCents: m, merchandiseCents: m, merchandiseIvaCents: Math.round((m * 16) / 116), processingFeeCents: 0, compensationCents: r() < 0.3 ? int(4000) : 0, paidAt: at, ...link };
}

describe('pnlLinesBuckets contra pnlBuckets (BD simulada, datos aleatorios)', () => {
  it('N=400 escenarios: Σ(5 líneas) == plano al centavo (ingreso, costo, comisión) y contribution == profitCents', async () => {
    const r = rng(20261124);
    let withMismatch = 0;
    for (let n = 0; n < 400; n++) {
      const w = genWorld(r, `s${n}`);
      const db = fakeDb(w);
      const counters = { costMissingCount: 0, allocationMismatchOrders: 0 };
      const flat = (await pnlBuckets(db, undefined, () => 'all')).get('all') ?? zeroPnl();
      const set = (await pnlLinesBuckets(db, undefined, () => 'all', { counters })).get('all') ?? zeroLineSet();
      const t = totalOf(set);
      const col = columnOf(t, true);
      expect(col.contributionCents).toBe(flat.profitCents);
      expect(t.grossSalesCents - t.discountsCents).toBe(flat.incomeCents);
      expect(t.cogsCents).toBe(flat.cogsCents);
      expect(t.paymentFeeCents).toBe(flat.stripeFeesCents);
      // Σ columnas == total en cada clave (el total se arma de las líneas; se comprueba además por la vía de columnOf)
      const sumCols = (['grossSalesCents', 'discountsCents', 'refundsCents', 'netSalesCents', 'cogsCents', 'grossProfitCents', 'contributionCents'] as const).map((k) =>
        (['sealed', 'raw', 'graded', 'accessory', 'unassigned'] as const).reduce((s, l) => s + columnOf(set[l])[k], 0),
      );
      expect(sumCols).toEqual((['grossSalesCents', 'discountsCents', 'refundsCents', 'netSalesCents', 'cogsCents', 'grossProfitCents', 'contributionCents'] as const).map((k) => col[k]));
      if (counters.allocationMismatchOrders > 0) withMismatch++;
      for (const v of Object.values(col)) if (typeof v === 'number') expect(Number.isInteger(v)).toBe(true);
    }
    expect(withMismatch).toBeGreaterThan(0); // el generador SÍ produce pedidos que no cuadran (el contador se ejercita)
  });

  it('caso a mano: comisión 301 sobre 6000/3000/1000 ⇒ 181/90/30 (el centavo va al mayor residuo); retiro sin pedido ⇒ unassigned; reembolso por pieza ⇒ su línea', async () => {
    const o = {
      id: 'o1', status: 'settled', settledAt: new Date('2026-03-10T18:00:00Z'), subtotalCents: 10000, discountCents: 0, ivaCents: 1600, ivaRatePct: 16,
      priceConvention: 'IVA_EXCLUSIVE', feeConvention: 'FEE_ON_TOP', stripeFeeCents: null, processingFeeCents: 301, totalCents: 11600, stripePaymentIntentId: 'pi', fulfillmentMode: 'vault', shippingFeeCents: 0,
      items: [
        { id: 'i-raw', unitPriceCents: 6000, unitDiscountCents: 0, inventoryItem: { productType: 'raw', acquisitionCostCents: 2000, acquisitionCostIvaCents: 0 } },
        { id: 'i-sealed', unitPriceCents: 3000, unitDiscountCents: 0, inventoryItem: { productType: 'sealed', acquisitionCostCents: 1000, acquisitionCostIvaCents: 0 } },
      ],
      accessoryLines: [{ id: 'a1', kind: 'accessory', status: 'sold', quantity: 2, unitPriceCents: 500, unitDiscountCents: 0, unitCostCents: 100, shipmentLine: null, components: [] }],
    };
    const w: any = {
      orders: [o], allOrders: [o], items: [...o.items],
      shipments: [{ id: 'v1', orderId: null, pickingAt: o.settledAt, priceConvention: 'IVA_EXCLUSIVE', shippingFeeCents: 5000, ivaCents: 800, shippingCostCents: 3000, shippingCostIvaCents: 0, insuranceCostCents: 0, labelSource: 'skydropx', feeConvention: 'FEE_ON_TOP', stripeFeeCents: null, processingFeeCents: 50, totalCents: 5800, stripePaymentIntentId: 'pi2' }],
      adjustments: [],
      stripeRefunds: [refund(() => 0.5, o.settledAt, { orderId: 'o1', orderItemId: 'i-sealed', merchandiseCents: 1000, merchandiseIvaCents: 0, shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 0, compensationCents: 0, amountCents: 1000 })],
      speiRefunds: [], paidSell: [],
    };
    const set = (await pnlLinesBuckets(fakeDb(w), undefined, () => 'all')).get('all')!;
    expect(set.raw.paymentFeeCents).toBe(181);
    expect(set.sealed.paymentFeeCents).toBe(90);
    expect(set.accessory.paymentFeeCents).toBe(30);
    expect(set.raw.grossSalesCents).toBe(6000);
    expect(set.accessory.grossSalesCents).toBe(1000);
    expect(set.raw.cogsCents).toBe(2000);
    expect(set.accessory.cogsCents).toBe(200);
    expect(set.sealed.refundsCents).toBe(1000);
    expect(set.raw.refundsCents).toBe(0);
    // retiro de bóveda: ingreso 5000 − costo 3000 = +2000 de envío, y su comisión 50, todo en unassigned
    expect(set.unassigned.shippingResultCents).toBe(2000);
    expect(set.unassigned.paymentFeeCents).toBe(50);
    expect(set.unassigned.grossSalesCents).toBe(0);
    const flat = (await pnlBuckets(fakeDb(w), undefined, () => 'all')).get('all')!;
    expect(columnOf(totalOf(set)).contributionCents).toBe(flat.profitCents);
  });
});
