/**
 * reports-f2b-pnl-lines.e2e-spec.ts — 💰 §REPORTES-CEO F2b (API_CONTRACT_REPORTES §3, §3b, §9 M-1/M-3/M-4/M-5/M-6) con Postgres REAL.
 *
 * Fixture: la de ventas (`helpers/sales-db.ts`, feb–mar 2021: pedidos con y sin IVA incluido, directos y de bóveda, retiro de bóveda,
 * ajuste de guía, reembolsos de pedido y SPEI de retiro, buylist, contracargo) MÁS pedidos propios de abril/mayo 2021 con las tres
 * líneas de pieza, accesorio, descuentos y un reembolso por pieza que cruza de mes. Todo el dinero sale de Postgres.
 *
 * Qué amarra:
 *  - M-1 paridad: N=200 rangos aleatorios (1 día a 3 meses) + sin rango: Σ(5 líneas) == total en cada clave de `PnlColumn` y
 *    `total.contributionCents == profitCents` de `admin.pnl()`; igual por cada cubo de `series` (Σ cubos = rango).
 *  - M-3 clasificación: venta por línea en SU columna; retiro de bóveda y buylist solo en `unassigned`; reembolso por `orderItemId` baja
 *    la línea de esa pieza en el mes de su fecha de salida.
 *  - M-4 consolidados: cada cubo == `report(from,to)`; Σ meses = trimestre, Σ trimestres = semestre… con dial 1, 4, 12.
 *  - M-5 roles: operador/cliente 403, sin token 401; ningún `*Cents` no entero.
 *  - M-6 índice `Order_settledAt_idx` existe y el planificador lo usa.
 */
import { E2EHarness } from './helpers/e2e-app';
import { cleanupSales, mkOrder, mx, SID, seedSales } from './helpers/sales-db';
import { AdminService } from '../../src/modules/admin/admin.service';
import { ReportsFinanceService } from '../../src/modules/admin/reports-finance.service';
import { SalesAnalyticsService } from '../../src/modules/sales-analytics/sales-analytics.service';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const LINES = ['sealed', 'raw', 'graded', 'accessory', 'unassigned'] as const;
const P = 'f2b-';
const F = { x1: `${P}ord-x1`, x2: `${P}ord-x2`, x3: `${P}ord-x3`, acc: `${P}acc`, accLine: `${P}accline`, refX1: `${P}ref-x1`, refAcc: `${P}ref-acc`, refMay: `${P}ref-may` };

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ymdAdd = (ymd: string, n: number) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + n)).toISOString().slice(0, 10);

/** Recorre una respuesta y devuelve toda clave `*Cents` cuyo valor no sea entero ni null (M-5). */
function nonIntegerCents(x: unknown, path = '$'): string[] {
  const bad: string[] = [];
  if (Array.isArray(x)) x.forEach((v, i) => bad.push(...nonIntegerCents(v, `${path}[${i}]`)));
  else if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      if (/Cents$/.test(k) && v !== null && typeof v !== 'object' && !Number.isInteger(v)) bad.push(`${path}.${k}=${String(v)}`);
      else bad.push(...nonIntegerCents(v, `${path}.${k}`));
    }
  }
  return bad;
}

describe('§REPORTES-CEO F2b — P&L por línea con dinero real (Postgres)', () => {
  let h: E2EHarness;
  let admin: AdminService;
  let fin: ReportsFinanceService;
  let adminToken: string;
  let operatorToken: string;
  let customerToken: string;

  async function wipeMine() {
    const db = h.prisma;
    await db.paymentRefund.deleteMany({ where: { id: { startsWith: P } } });
    await db.orderAccessoryLine.deleteMany({ where: { id: { startsWith: P } } });
    await db.orderItem.deleteMany({ where: { orderId: { startsWith: P } } });
    await db.order.deleteMany({ where: { id: { startsWith: P } } });
    await db.accessory.deleteMany({ where: { id: { startsWith: P } } });
    await db.configSetting.deleteMany({ where: { key: 'fiscal_year_start_month' } });
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await wipeMine();
    await seedSales(h.prisma);
    admin = h.app.get(AdminService);
    fin = h.app.get(ReportsFinanceService);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operatorToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    const db = h.prisma;
    await db.accessory.create({ data: { id: F.acc, name: 'F2B funda', category: 'sleeves', lengthMm: 90, widthMm: 70, heightMm: 30, weightG: 120, priceCents: 2500, unitCostCents: 1200, stockQty: 50, reservedQty: 0 } });
    // X1 (abril, directo, IVA incluido, con descuentos por pieza y de pedido): sellado 12 000 (−1 000), raw 8 000 (−500), gradeada 20 000, 3 fundas a 2 500 (−100 c/u).
    const x1 = await mkOrder(db, {
      id: F.x1, userId: SID.userA, status: 'settled', settledAt: mx('2021-04-06', 12), conv: 'IVA_INCLUSIVE', mode: 'direct_ship', subtotal: 47500, shipping: 11600, iva: 9500, fee: 1701, total: 59100,
      items: [
        { card: SID.cardS, productType: 'sealed', unit: 12000, acq: 8000, sealedProductId: SID.sealed },
        { card: SID.cardX, productType: 'raw', unit: 8000, acq: 3000 },
        { card: SID.cardZ, productType: 'graded', unit: 20000, acq: 9000 },
      ],
    });
    await db.orderItem.update({ where: { id: x1[0] }, data: { unitDiscountCents: 1000 } });
    await db.orderItem.update({ where: { id: x1[1] }, data: { unitDiscountCents: 500 } });
    await db.order.update({ where: { id: F.x1 }, data: { discountCents: 1800 } });
    await db.orderAccessoryLine.create({
      data: { id: F.accLine, orderId: F.x1, kind: 'accessory', accessoryId: F.acc, quantity: 3, unitPriceCents: 2500, unitCostCents: 1200, unitDiscountCents: 100, snapshot: { name: 'F2B funda', category: 'sleeves' }, status: 'sold', reservedUntil: mx('2021-04-06', 13), soldAt: mx('2021-04-06', 12) },
    });
    // La gradeada de X1 se reembolsa en MAYO (fecha de salida): baja la línea gradeada de mayo, no la de abril. Más: una funda en abril.
    await db.paymentRefund.create({
      data: { id: F.refMay, idempotencyKey: `${P}ref-may`, kind: 'order_remaining', status: 'succeeded', orderId: F.x1, orderItemId: x1[2], amountCents: 20300, merchandiseCents: 20000, merchandiseIvaCents: 2759, shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 300, compensationCents: 0, requestedByUserId: SID.userC, requestedByRole: 'super_admin', stripeRefundId: 're_f2b_may', submittedAt: mx('2021-05-04', 11) },
    });
    await db.paymentRefund.create({
      data: { id: F.refAcc, idempotencyKey: `${P}ref-acc`, kind: 'item_delivered', status: 'submitted', orderId: F.x1, orderAccessoryLineId: F.accLine, accessoryQty: 1, reason: 'f2b: funda dañada', deliveredReason: 'arrived_damaged', amountCents: 2400, merchandiseCents: 2400, merchandiseIvaCents: 331, shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 0, requestedByUserId: SID.userC, requestedByRole: 'super_admin', stripeRefundId: 're_f2b_acc', submittedAt: mx('2021-04-09', 10) },
    } as never);
    // X2 (abril, bóveda, IVA exclusivo): raw 5 000 + sellado 5 000 con comisión 301 ⇒ el reparto tiene residuo.
    await mkOrder(db, {
      id: F.x2, userId: SID.userB, status: 'settled', settledAt: mx('2021-04-07', 9), conv: 'IVA_EXCLUSIVE', subtotal: 10000, iva: 1600, fee: 301, total: 11901,
      items: [
        { card: SID.cardY, productType: 'raw', unit: 5000, acq: 2000 },
        { card: SID.cardS, productType: 'sealed', unit: 5000, acq: 2500, sealedProductId: SID.sealed },
      ],
    });
    // X3 (mayo, bóveda, reembolsado del todo): una gradeada; su subtotal (11 700) NO cuadra con lo cobrado (11 600) ⇒ `allocationMismatchOrders`.
    await mkOrder(db, { id: F.x3, userId: SID.userB, status: 'refunded', settledAt: mx('2021-05-03', 15), conv: 'IVA_INCLUSIVE', subtotal: 11700, iva: 1600, fee: 400, total: 12100, items: [{ card: SID.cardZ, productType: 'graded', unit: 11600, acq: 7000 }] });
  }, 180000);

  afterAll(async () => {
    if (h) {
      await wipeMine();
      await cleanupSales(h.prisma);
    }
    await h?.close();
  });

  const NUM_KEYS = ['grossSalesCents', 'discountsCents', 'refundsCents', 'netSalesCents', 'cogsCents', 'grossProfitCents', 'contributionCents'] as const;
  function expectColumnsSum(rep: { own: Record<string, any>; total: any }) {
    for (const k of NUM_KEYS) expect(LINES.reduce((s, l) => s + rep.own[l][k], 0)).toBe(rep.total[k]);
    expect(LINES.reduce((s, l) => s + rep.own[l].sellingCosts.paymentFeeCents, 0)).toBe(rep.total.sellingCosts.paymentFeeCents);
    expect(LINES.reduce((s, l) => s + rep.own[l].sellingCosts.shippingResultCents, 0)).toBe(rep.total.sellingCosts.shippingResultCents);
    expect(rep.total).toEqual(rep.own.total);
  }

  it('M-1: N=200 rangos aleatorios — Σ(5 columnas) == total en cada clave, total.contributionCents == profitCents del plano y las partes cuadran', async () => {
    const r = rng(20261124);
    let checked = 0;
    let nonZero = 0;
    for (let i = 0; i < 200; i++) {
      const from = ymdAdd('2021-02-20', Math.floor(r() * 80));
      const to = ymdAdd(from, Math.floor(r() * 75));
      const rep: any = await fin.report({ from, to });
      const flat = await admin.pnl(from, to);
      expectColumnsSum(rep);
      expect(rep.total.contributionCents).toBe(flat.profitCents);
      expect(rep.total.grossSalesCents - rep.total.discountsCents).toBe(flat.incomeCents);
      expect(rep.total.cogsCents).toBe(flat.cogsCents);
      expect(rep.total.sellingCosts.paymentFeeCents).toBe(flat.stripeFeesCents);
      expect(nonIntegerCents(rep)).toEqual([]);
      if (flat.profitCents !== 0) nonZero++;
      checked++;
    }
    expect(checked).toBe(200);
    expect(nonZero).toBeGreaterThan(100); // el rango aleatorio sí toca dinero (no se mide un 0 == 0)
    const all: any = await fin.report({});
    expect(all.period).toBeNull();
    expect(all.previous).toBeNull();
    expect(all.comparison).toBeNull();
    expectColumnsSum(all);
    expect(all.total.contributionCents).toBe((await admin.pnl()).profitCents);
  }, 600000);

  it('M-1 (series): por cada cubo día/semana Σ cubos == total == el rango, en las cinco líneas y en `all`', async () => {
    const r = rng(7);
    for (let i = 0; i < 12; i++) {
      const from = ymdAdd('2021-02-25', Math.floor(r() * 60));
      const to = ymdAdd(from, 5 + Math.floor(r() * 40));
      const rep: any = await fin.report({ from, to });
      for (const groupBy of ['day', 'week'] as const) {
        for (const line of ['all', ...LINES] as const) {
          const s: any = await fin.series({ from, to, groupBy, line });
          const want = line === 'all' ? rep.total : rep.own[line];
          for (const k of NUM_KEYS) expect(s.buckets.reduce((acc: number, b: any) => acc + b.column[k], 0)).toBe(want[k]);
          expect(s.buckets.reduce((acc: number, b: any) => acc + b.column.sellingCosts.paymentFeeCents, 0)).toBe(want.sellingCosts.paymentFeeCents);
          expect(s.buckets.reduce((acc: number, b: any) => acc + b.column.sellingCosts.shippingResultCents, 0)).toBe(want.sellingCosts.shippingResultCents);
          for (const k of NUM_KEYS) expect(s.total[k]).toBe(want[k]);
          expect(s.buckets[0].from).toBe(from);
          expect(s.buckets[s.buckets.length - 1].to).toBe(to);
        }
      }
    }
  }, 300000);

  it('M-3: cada venta cae en SU columna; retiro de bóveda y buylist pagado solo en `unassigned`; el reembolso por pieza baja SU línea en el mes de su fecha', async () => {
    // O4 (2021-03-02): sellado 12 000 + gradeada 8 000, IVA exclusivo, sin descuento, sin envío.
    const o4: any = await fin.report({ from: '2021-03-02', to: '2021-03-02' });
    expect(o4.own.sealed.grossSalesCents).toBe(12000);
    expect(o4.own.graded.grossSalesCents).toBe(8000);
    expect(o4.own.sealed.cogsCents).toBe(8000);
    expect(o4.own.graded.cogsCents).toBe(4000);
    expect(o4.own.raw.grossSalesCents).toBe(0);
    expect(o4.own.accessory.grossSalesCents).toBe(0);
    // Retiro de bóveda S9 (2021-03-04, sin pedido): solo `unassigned` (ingreso de envío − costo, y su comisión).
    const s9: any = await fin.report({ from: '2021-03-04', to: '2021-03-04' });
    for (const l of ['sealed', 'raw', 'graded', 'accessory'] as const) {
      expect(s9.own[l].sellingCosts.shippingResultCents).toBe(0);
      expect(s9.own[l].sellingCosts.paymentFeeCents).toBe(0);
    }
    expect(s9.own.unassigned.sellingCosts.shippingResultCents).not.toBe(0);
    // Solicitud del buylist pagada (2021-03-05): tarifa retenida solo en `unassigned`.
    const sr1: any = await fin.report({ from: '2021-03-05', to: '2021-03-05' });
    for (const l of ['sealed', 'raw', 'graded', 'accessory'] as const) expect(sr1.own[l].sellingCosts.shippingResultCents).toBe(0);
    expect(sr1.memo.buylist.retainedFeeCents).toBeGreaterThan(0);
    expect(sr1.own.unassigned.sellingCosts.shippingResultCents).toBe(sr1.memo.buylist.retainedFeeCents - sr1.memo.buylist.guideCostCents);
    // X1 en abril: gradeada vendida 20 000 − descuento 0; sellado 12 000+1 000 de descuento; el reembolso de MAYO no baja abril.
    const abr: any = await fin.report({ from: '2021-04-06', to: '2021-04-06' });
    expect(abr.own.graded.grossSalesCents).toBeGreaterThan(0);
    expect(abr.own.graded.refundsCents).toBe(0);
    expect(abr.own.accessory.cogsCents).toBe(3600);
    expect(abr.own.sealed.discountsCents + abr.own.raw.discountsCents + abr.own.accessory.discountsCents + abr.own.graded.discountsCents).toBeGreaterThan(0);
    // Mayo: la línea gradeada baja (mercancía neta 17 241 + comisión devuelta 300) y ninguna otra.
    const may: any = await fin.report({ from: '2021-05-04', to: '2021-05-04' });
    expect(may.own.graded.refundsCents).toBe(20000 - 2759 + 300);
    for (const l of ['sealed', 'raw', 'accessory', 'unassigned'] as const) expect(may.own[l].refundsCents).toBe(0);
    // El reembolso de la funda cae en la línea de accesorios (abril 9).
    const fund: any = await fin.report({ from: '2021-04-09', to: '2021-04-09' });
    expect(fund.own.accessory.refundsCents).toBe(2400 - 331);
    // SPEI de retiro entregado sin pedido (2021-03-06): `unassigned`.
    const sp: any = await fin.report({ from: '2021-03-06', to: '2021-03-06' });
    for (const l of ['sealed', 'raw', 'graded', 'accessory'] as const) expect(sp.own[l].refundsCents).toBe(0);
    // X2: comisión 301 sobre 5 000/5 000 ⇒ 151/150 (el centavo, al id menor entre iguales)
    const x2: any = await fin.report({ from: '2021-04-07', to: '2021-04-07' });
    expect(x2.own.raw.sellingCosts.paymentFeeCents + x2.own.sealed.sellingCosts.paymentFeeCents).toBe(301);
    expect([x2.own.raw.sellingCosts.paymentFeeCents, x2.own.sealed.sellingCosts.paymentFeeCents].sort()).toEqual([150, 151]);
  }, 120000);

  it('contadores y memo: costMissingCount, allocationMismatchOrders, contracargos, IVA y compras salen de los datos (independientes del reparto)', async () => {
    const from = '2021-03-01';
    const to = '2021-05-31';
    const rep: any = await fin.report({ from, to });
    const rng = { gte: mx(from, 0), lt: mx('2021-06-01', 0) };
    const orders = await h.prisma.order.findMany({
      where: { status: { in: ['settled', 'refunded'] }, settledAt: rng },
      select: { subtotalCents: true, items: { select: { unitPriceCents: true, inventoryItem: { select: { acquisitionCostCents: true } } } }, accessoryLines: { select: { quantity: true, unitPriceCents: true } } },
    });
    const missing = orders.reduce((s, o) => s + o.items.filter((i) => i.inventoryItem.acquisitionCostCents == null).length, 0);
    const mismatch = orders.filter((o) => o.items.reduce((s, i) => s + i.unitPriceCents, 0) + o.accessoryLines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0) !== o.subtotalCents).length;
    expect(rep.costMissingCount).toBe(missing);
    expect(rep.allocationMismatchOrders).toBe(mismatch);
    expect(mismatch).toBeGreaterThan(0); // X3 (subtotal 11 700 vs una pieza de 11 600) ejercita el contador
    const cb = await h.prisma.order.findMany({ where: { status: 'chargeback', settledAt: rng }, select: { totalCents: true } });
    expect(rep.memo.chargebacks).toEqual({ orders: cb.length, cents: cb.reduce((s, o) => s + o.totalCents, 0) });
    expect(cb.length).toBeGreaterThan(0);
    const iva = await admin.ivaReport(from, to);
    expect(rep.memo.iva).toEqual({ collectedCents: iva.ivaCollectedCents, refundedCents: iva.ivaRefundedCents, netCents: iva.ivaNetCents });
    const flat = await admin.pnl(from, to);
    expect(rep.memo.shipping).toEqual({ insuranceCents: flat.shippingInsuranceCents, adjustmentsCents: flat.shippingAdjustmentsCents });
    expect(rep.memo.buylist).toEqual({ retainedFeeCents: flat.buylistShippingFeeRetainedCents, guideCostCents: flat.buylistGuideCostCents });
    expect(rep.marketplace).toEqual({ available: false, gmvCents: null, commissionCents: null });
    expect(rep.total.fixedCostsCents).toBeNull();
    expect(rep.total.resultCents).toBeNull();
  }, 120000);

  it('comparación: previous/comparison del mismo tramo y `period.toDate` (30-nov-style: último día = cerrado)', async () => {
    const closed: any = await fin.report({ from: '2021-03-01', to: '2021-03-31', kind: 'month' });
    expect(closed.period).toEqual({ from: '2021-03-01', to: '2021-03-31', kind: 'month', days: 31, timezone: 'America/Mexico_City', toDate: false });
    expect(closed.previousPeriod).toEqual({ from: '2021-02-01', to: '2021-02-28', clamped: false });
    const part: any = await fin.report({ from: '2021-03-01', to: '2021-03-30', kind: 'month' });
    expect(part.period.toDate).toBe(true);
    expect(part.previousPeriod).toEqual({ from: '2021-02-01', to: '2021-02-28', clamped: true });
    const feb: any = await fin.report({ from: '2021-02-01', to: '2021-02-28' });
    expect(closed.previous.total).toEqual(feb.total);
    expect(closed.comparison.total.contributionCents).toEqual({
      cents: closed.total.contributionCents,
      previousCents: feb.total.contributionCents,
      deltaCents: closed.total.contributionCents - feb.total.contributionCents,
      deltaBps: feb.total.contributionCents === 0 ? null : expect.any(Number),
    });
    expect(Object.keys(closed.comparison)).toEqual(['basis', 'dataSince', 'total', 'byLine']);
    expect(Object.keys(closed.comparison.total)).toEqual(['grossSalesCents', 'discountsCents', 'refundsCents', 'netSalesCents', 'cogsCents', 'grossProfitCents', 'paymentFeeCents', 'shippingResultCents', 'contributionCents']);
    // También en el P&L plano y en Ventas (aditivo, m-7)
    expect(((await admin.pnlReport('2021-03-01', '2021-03-31', 'month')) as any).period.toDate).toBe(false);
    expect(((await admin.pnlReport('2021-03-01', '2021-03-23', 'month')) as any).period.toDate).toBe(true);
    const sales = h.app.get(SalesAnalyticsService);
    expect(((await sales.report({ from: '2021-03-01', to: '2021-03-31', kind: 'month' }, new Date())) as any).period.toDate).toBe(false);
    expect(((await sales.report({ from: '2021-03-01', to: '2021-03-23', kind: 'month' }, new Date())) as any).period.toDate).toBe(true);
    expect(((await sales.report({ from: '2021-03-01', to: '2021-03-23' }, new Date())) as any).period.toDate).toBe(false); // sin kind ⇒ span
  }, 120000);

  describe('M-4 consolidados (CR-17..21) con dial 1, 4 y 12', () => {
    const AS_OF = '2021-05-31';
    const UNITS = ['month', 'quarter', 'semester', 'year'] as const;
    const setDial = async (v: number | null) => {
      await h.prisma.configSetting.deleteMany({ where: { key: 'fiscal_year_start_month' } });
      if (v !== null) await h.prisma.configSetting.create({ data: { key: 'fiscal_year_start_month', valueJson: v } as never });
    };
    const sumCols = (bs: any[]) => {
      const t: Record<string, number> = {};
      for (const k of NUM_KEYS) t[k] = bs.reduce((s, b) => s + b.total[k], 0);
      t.fee = bs.reduce((s, b) => s + b.total.sellingCosts.paymentFeeCents, 0);
      t.ship = bs.reduce((s, b) => s + b.total.sellingCosts.shippingResultCents, 0);
      return t;
    };
    // 31-may es el último día de la unidad: el mes siempre; con el año fiscal en dic. (dial 12) también el trimestre (Mar-May) y el semestre (Dic-May)
    const closedAtAsOf = (dial: number | null, unit: string) => unit === 'month' || (dial === 12 && (unit === 'quarter' || unit === 'semester'));
    const colsOf = (c: any) => ({ ...Object.fromEntries(NUM_KEYS.map((k) => [k, c[k]])), fee: c.sellingCosts.paymentFeeCents, ship: c.sellingCosts.shippingResultCents });

    afterAll(async () => setDial(null));

    it.each([[null], [1], [4], [12]])('dial %p: cada cubo == report(from,to) (total y por línea) y Σ de unidades menores == la mayor', async (dial) => {
      await setDial(dial);
      const byUnit: Record<string, any[]> = {};
      for (const unit of UNITS) {
        const s: any = await fin.series({ groupBy: unit, count: 3, asOf: AS_OF });
        expect(s.fiscalYearStartMonth).toBe(dial ?? 1);
        expect(s.buckets).toHaveLength(4);
        // `toDate` solo en el último, y solo si no es ya el último día de su unidad (el mes de mayo cierra el 31-may)
        expect(s.buckets.map((b: any) => b.toDate)).toEqual([false, false, false, !closedAtAsOf(dial, unit)]);
        expect(s.buckets[3].to).toBe(AS_OF);
        byUnit[unit] = s.buckets;
        for (const b of s.buckets.filter((x: any) => x.from >= '2020-01-01')) {
          // (el P&L plano del contrato solo acepta años 2020..2100; los cubos anteriores a 2020 solo existen para el cálculo)
          const rep: any = await fin.report({ from: b.from, to: b.to });
          expect(b.total).toEqual(rep.total);
          for (const l of LINES) expect(b.own[l]).toEqual(rep.own[l]);
          expect(nonIntegerCents(b)).toEqual([]);
        }
      }
      // Σ de los cubos de una unidad = el `report` de [primer from, último to] (CR-17) para las cuatro unidades
      for (const unit of UNITS) {
        const bs = byUnit[unit];
        const ok = bs.filter((x: any) => x.from >= '2020-01-01');
        const whole: any = await fin.report({ from: ok[0].from, to: ok[ok.length - 1].to });
        expect(sumCols(ok)).toEqual(colsOf(whole.total));
      }
      // Σ meses = trimestre, Σ trimestres = semestre, Σ semestres = año (por contención de rangos)
      let nestedChecks = 0;
      const nest = async (small: string, big: string) => {
        const smalls: any[] = (await fin.series({ groupBy: small as any, count: 12, asOf: AS_OF }) as any).buckets;
        for (const b of byUnit[big]) {
          const inside = smalls.filter((x) => x.from >= b.from && x.to <= b.to);
          // cubre el rango completo del grande cuando los pequeños lo alcanzan (12 cubos pequeños cubren ≥ 12 unidades)
          if (inside.length && inside[0].from === b.from && inside[inside.length - 1].to === b.to) {
            expect(sumCols(inside)).toEqual(colsOf(b.total));
            nestedChecks++;
          }
        }
        return smalls;
      };
      await nest('month', 'quarter');
      await nest('quarter', 'semester');
      await nest('semester', 'year');
      expect(nestedChecks).toBeGreaterThan(3);
    }, 600000);

    it('los bordes de cada unidad caen donde dice §3b con el dial 1, 4 y 12 (asOf 2021-05-31)', async () => {
      const edge = async (dial: number | null, unit: any) => {
        await setDial(dial);
        return ((await fin.series({ groupBy: unit, count: 1, asOf: AS_OF })) as any).buckets.map((b: any) => `${b.from}..${b.to}`);
      };
      expect(await edge(1, 'quarter')).toEqual(['2021-01-01..2021-03-31', '2021-04-01..2021-05-31']);
      expect(await edge(4, 'quarter')).toEqual(['2021-01-01..2021-03-31', '2021-04-01..2021-05-31']);
      expect(await edge(12, 'quarter')).toEqual(['2020-12-01..2021-02-28', '2021-03-01..2021-05-31']);
      expect(await edge(4, 'year')).toEqual(['2020-04-01..2021-03-31', '2021-04-01..2021-05-31']);
      expect(await edge(12, 'year')).toEqual(['2019-12-01..2020-11-30', '2020-12-01..2021-05-31']);
      expect(await edge(12, 'semester')).toEqual(['2020-06-01..2020-11-30', '2020-12-01..2021-05-31']);
    }, 120000);
  });

  describe('M-5 roles y forma HTTP', () => {
    const ROUTES = [
      '/admin/reports/finance/pnl?from=2021-03-01&to=2021-03-31',
      '/admin/reports/finance/pnl',
      '/admin/reports/finance/pnl/series?from=2021-03-01&to=2021-03-07&groupBy=day',
      '/admin/reports/finance/pnl/series?groupBy=month&count=2&asOf=2021-05-31',
    ];
    it.each(ROUTES)('%s — operador 403 (user.admin_action_denied), cliente 403, sin token 401', async (url) => {
      const op = await h.api('GET', url, { token: operatorToken });
      expect(op.status).toBe(403);
      expect(op.text).not.toMatch(/Cents/);
      expect((await h.api('GET', url, { token: customerToken })).status).toBe(403);
      expect((await h.api('GET', url)).status).toBe(401);
    });
    it('super_admin 200 por HTTP: sin ningún `*Cents` no entero; claves de PnlReport; errores 400/422', async () => {
      for (const url of ROUTES) {
        const r = await h.api('GET', url, { token: adminToken });
        expect(r.status).toBe(200);
        expect(nonIntegerCents(r.body)).toEqual([]);
        expect(r.headers['cache-control']).toBe('no-store');
      }
      const rep: any = (await h.api('GET', ROUTES[0], { token: adminToken })).body;
      expect(Object.keys(rep)).toEqual(['period', 'previousPeriod', 'firstDataDay', 'own', 'marketplace', 'total', 'memo', 'previous', 'comparison', 'costMissingCount', 'stripeFeeEstimatedOrders', 'allocationMismatchOrders']);
      expect(Object.keys(rep.own)).toEqual(['sealed', 'raw', 'graded', 'accessory', 'unassigned', 'total']);
      const bad = async (u: string) => (await h.api('GET', u, { token: adminToken })).status;
      expect(await bad('/admin/reports/finance/pnl/series?groupBy=hour&from=2021-03-01&to=2021-03-02')).toBe(400);
      expect(await bad('/admin/reports/finance/pnl/series?groupBy=day&from=2021-03-01&to=2021-03-02&line=nope')).toBe(400);
      expect(await bad('/admin/reports/finance/pnl/series?groupBy=month&count=13')).toBe(400);
      expect(await bad('/admin/reports/finance/pnl/series?groupBy=day&from=2020-01-01&to=2021-06-01')).toBe(400);
      expect(await bad('/admin/reports/finance/pnl?from=2026-02-30&to=2026-03-01')).toBe(422);
      expect(await bad('/admin/reports/finance/pnl?from=2019-01-01&to=2019-02-01')).toBe(422);
      expect(await bad('/admin/reports/finance/pnl?from=2026-03-01')).toBe(400);
      expect(await bad('/admin/reports/finance/pnl?from=hola&to=2026-03-01')).toBe(400);
      expect(await bad('/admin/reports/finance/pnl?from=2021-03-01&to=2021-03-02&kind=zzz')).toBe(400);
    });
    it('el P&L plano `/admin/finance/pnl` no pierde ni cambia claves (solo `period.toDate` aditivo)', async () => {
      const r: any = (await h.api('GET', '/admin/finance/pnl?from=2021-03-01&to=2021-03-31&kind=month', { token: adminToken })).body;
      expect(r.period).toEqual({ from: '2021-03-01', to: '2021-03-31', kind: 'month', days: 31, timezone: 'America/Mexico_City', toDate: false });
      expect(r.profitCents).toBe((await fin.report({ from: '2021-03-01', to: '2021-03-31' }) as any).total.contributionCents);
    });
  });

  it('M-6: el índice `Order_settledAt_idx` existe y el planificador lo usa para el mínimo y el rango', async () => {
    const idx = await h.prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename = 'Order' AND indexname = 'Order_settledAt_idx'`;
    expect(idx).toHaveLength(1);
    const plan = await h.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      const a = await tx.$queryRaw<{ 'QUERY PLAN': string }[]>`EXPLAIN SELECT MIN("settledAt") FROM "Order"`;
      const b = await tx.$queryRaw<{ 'QUERY PLAN': string }[]>`EXPLAIN SELECT id FROM "Order" WHERE "settledAt" >= '2021-03-01' AND "settledAt" < '2021-04-01'`;
      return [...a, ...b].map((r) => r['QUERY PLAN']).join('\n');
    });
    expect(plan).toMatch(/Order_settledAt_idx/);
  });
});
