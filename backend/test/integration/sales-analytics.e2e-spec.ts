/**
 * 💰 §AN — la analítica de ventas del dueño contra Postgres REAL (API_CONTRACT §15.6: AN-B-1…4, 6, 8–12, 15–18, 21, 22).
 * Las piezas puras (AN-B-5, 7, 14, 21 puro, 23) están en `test/sales-analytics.units.spec.ts`; AN-B-13 en
 * `sales-analytics-pnl-parity.e2e-spec.ts`.
 *
 * Fixture: `helpers/sales-db.ts` (marzo y mayo de 2021, ventana propia, ids fijos). El reloj se INYECTA (`report(q, now)`),
 * así que todo es determinista: N=1 por corrida, dicho así. El arnés es el de D2g (`createSpendWorld`: dueña con correo y
 * marca, operador, correo capturado) porque AN-B-18 necesita el resumen de las 08:00.
 */
import { createSpendWorld, SpendWorld } from './helpers/spend-db';
import { cleanupSales, EMAIL, mx, SID, seedSales, seedSalesMay } from './helpers/sales-db';
import { SalesAnalyticsService } from '../../src/modules/sales-analytics/sales-analytics.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { SpendDigestService } from '../../src/modules/spend-alerts/spend-digest.service';
import { mxDayStart, nextYmd } from '../../src/modules/spend-alerts/mx-day';
import { netRevenueCents } from '../../src/common/money';
import type { SalesFigures } from '../../src/modules/sales-analytics/sales-figures';

let w: SpendWorld;
let svc: SalesAnalyticsService;
let admin: AdminService;
const DIGEST_DAYS = ['2021-03-07', '2021-03-03'].map((d) => new Date(`${d}T00:00:00.000Z`));

/** El instante de «ahora» de las pruebas de marzo: domingo 2021-03-07 21:00 MX (después del último pedido). */
const NOW_MARCH = mx('2021-03-07', 21);
const P = { from: '2021-03-01', to: '2021-03-07' };

const ADDITIVE: Array<(f: SalesFigures) => number> = [
  (f) => f.orders,
  (f) => f.chargedCents,
  (f) => f.netSalesCents,
  (f) => f.refunds.count,
  (f) => f.refunds.amountCents,
  (f) => f.refunds.netCents,
  (f) => f.refunds.byChannel.card.count,
  (f) => f.refunds.byChannel.card.amountCents,
  (f) => f.refunds.byChannel.spei.count,
  (f) => f.refunds.byChannel.spei.amountCents,
  (f) => f.netSalesAfterRefundsCents,
  (f) => f.pieces,
  (f) => f.shipping.chargedNetCents,
  (f) => f.shipping.costNetCents,
  (f) => f.shipping.costMissingCount,
  (f) => f.shipping.adjustmentsCents,
  (f) => f.shipping.resultNetCents,
  (f) => f.buylist.paidCount,
  (f) => f.buylist.paidNetCents,
  (f) => f.buylist.paidWithoutPayoutCount,
  (f) => f.profitCents,
];
const sum = (rows: SalesFigures[], pick: (f: SalesFigures) => number) => rows.reduce((a, r) => a + pick(r), 0);

beforeAll(async () => {
  w = await createSpendWorld();
  await seedSales(w.h.prisma);
  await seedSalesMay(w.h.prisma);
  await w.h.prisma.spendDigestRun.deleteMany({ where: { day: { in: DIGEST_DAYS } } });
  svc = w.h.app.get(SalesAnalyticsService);
  admin = w.h.app.get(AdminService);
}, 180000);

afterAll(async () => {
  if (w) {
    await w.h.prisma.spendDigestRun.deleteMany({ where: { day: { in: DIGEST_DAYS } } });
    await cleanupSales(w.h.prisma);
    await w.close();
  }
});

describe('§AN fase A — cifras por día (Postgres real)', () => {
  it('AN-B-1: 23:30 y 00:10 MX en su día; `today` con reloj inyectado; `to` incluye 23:59:59.999 y excluye 00:00 del siguiente', async () => {
    const r = await svc.report(P, NOW_MARCH);
    const row = (d: string) => r.rows.find((x) => x.from === d)!;
    // O2 a las 23:30 del lunes y O4 a las 00:10 del martes (UTC: los dos el martes 2021-03-02).
    expect(row('2021-03-01').orders).toBe(3);
    expect(row('2021-03-02').orders).toBe(1);
    expect(row('2021-03-02').chargedCents).toBe(24100);
    // Mayo (UTC−5): M9 a las 23:59:59.999 del 12 entra; M10 a las 00:00:00.000 del 13 no.
    const may = await svc.report({ from: '2021-05-11', to: '2021-05-12' }, mx('2021-05-13', 12));
    expect(may.rows.map((x) => [x.from, x.orders, x.chargedCents])).toEqual([
      ['2021-05-11', 2, 34800],
      ['2021-05-12', 3, 928 + 11600 + 11600],
    ]);
    // «Hoy» a las 15:00 del 12 incluye M8, cobrado hace un minuto.
    const today = await svc.report({ preset: 'today' }, mx('2021-05-12', 15));
    expect(today.period).toMatchObject({ preset: 'today', from: '2021-05-12', to: '2021-05-12', days: 1, timezone: 'America/Mexico_City' });
    expect(today.rows).toHaveLength(1);
    expect(today.rows[0].orders).toBe(3);
  });

  it('AN-B-2: envío, bóveda e invitado pagados cuentan; failed y pending no; 116.00 + 232.00 = 348.00', async () => {
    const r = await svc.report({ from: '2021-05-10', to: '2021-05-11' }, mx('2021-05-13', 12));
    expect(r.rows[0]).toMatchObject({ from: '2021-05-10', orders: 3, chargedCents: 11600 + 23200 + 5800 });
    expect(r.rows[1]).toMatchObject({ from: '2021-05-11', orders: 2, chargedCents: 34800 });
  });

  it('AN-B-3 💰: cuadre con M7 al centavo — Σ netSales = pnl.income + Σ netRevenue(refunded|chargeback); Σ refunds.net = pnl.refunds', async () => {
    const r = await svc.report(P, NOW_MARCH);
    const pnl = await admin.pnl(mxDayStart(P.from).toISOString(), new Date(mxDayStart(nextYmd(P.to)).getTime() - 1).toISOString());
    const gap = await w.h.prisma.order.findMany({
      where: { settledAt: { gte: mxDayStart(P.from), lt: mxDayStart(nextYmd(P.to)) }, status: { in: ['refunded', 'chargeback'] } },
      select: { subtotalCents: true, ivaRatePct: true, priceConvention: true },
    });
    const gapCents = gap.reduce((a, o) => a + netRevenueCents(o), 0);
    const netSales = sum(r.rows, (f) => f.netSalesCents);
    expect(netSales).toBe(pnl.incomeCents + gapCents);
    expect(sum(r.rows, (f) => f.refunds.netCents)).toBe(pnl.refundsCents);
    // A mano (fixture): O1 10000 + O3 INCL ⌊11601/1.16⌉ 10001 + O2 INCL 20000 + O4 20000 + O5 5000 + O8 3000.
    expect(netSales).toBe(68001);
    expect(pnl.incomeCents).toBe(53000);
    expect(gapCents).toBe(10001 + 5000);
    expect(pnl.refundsCents).toBe(10001 + 6720 + 4200);
    // CONTROL: la fixture tiene IVA_INCLUSIVE donde la mutación m3 (subtotal en vez de neto) se nota.
    expect(sum(r.rows, (f) => f.chargedCents)).toBe(12100 + 12201 + 36300 + 24100 + 6100 + 3680);
  });

  it('AN-B-4 💰: reembolso total el miércoles deja el lunes intacto; el de UNA carta deja el pedido; se resta una sola vez', async () => {
    const r = await svc.report(P, NOW_MARCH);
    const row = (d: string) => r.rows.find((x) => x.from === d)!;
    // Lunes: O1 + O3 (hoy `refunded`) + O2 — O3 sigue ahí con su cobrado y su venta.
    expect(row('2021-03-01')).toMatchObject({ orders: 3, chargedCents: 12100 + 12201 + 36300, netSalesCents: 10000 + 10001 + 20000, refunds: { count: 0 } });
    // Miércoles: 1 reembolso, sin pedidos; la venta neta baja EXACTAMENTE su parte sin IVA.
    expect(row('2021-03-03').refunds).toEqual({ count: 1, amountCents: 12201, netCents: 10001, byChannel: { card: { count: 1, amountCents: 12201 }, spei: { count: 0, amountCents: 0 } } });
    expect(row('2021-03-03').netSalesAfterRefundsCents).toBe(-10001);
    // Jueves: el de una carta de O4; O4 sigue contado el martes.
    expect(row('2021-03-04').refunds).toMatchObject({ count: 1, amountCents: 9670, netCents: 6720 });
    expect(row('2021-03-02')).toMatchObject({ orders: 1, netSalesCents: 20000 });
    // Viernes: el `failed` no cuenta; sábado: el SPEI pagado sí, una vez.
    expect(row('2021-03-05').refunds.count).toBe(0);
    expect(row('2021-03-06').refunds).toMatchObject({ count: 1, amountCents: 6000, netCents: 4200, byChannel: { spei: { count: 1, amountCents: 6000 } } });
    // El periodo resta una sola vez.
    expect(r.totals.netSalesAfterRefundsCents).toBe(68001 - 20921);
    expect(sum(r.rows, (f) => f.netSalesAfterRefundsCents)).toBe(r.totals.netSalesAfterRefundsCents);
  });

  it('AN-B-6: 7 filas (también las de cero); semana y mes suman sus días; totals idéntico en los tres groupBy', async () => {
    const q = { from: '2021-02-24', to: '2021-03-09' };
    const now = mx('2021-03-10', 12);
    const [day, week, month] = await Promise.all([
      svc.report({ ...q, groupBy: 'day' }, now),
      svc.report({ ...q, groupBy: 'week' }, now),
      svc.report({ ...q, groupBy: 'month' }, now),
    ]);
    expect(day.rows).toHaveLength(14);
    expect(day.rows.filter((x) => x.orders === 0).length).toBeGreaterThan(0);
    // 2021-02-24 es miércoles: semanas recortadas en los dos bordes.
    expect(week.rows.map((x) => [x.from, x.to])).toEqual([
      ['2021-02-24', '2021-02-28'],
      ['2021-03-01', '2021-03-07'],
      ['2021-03-08', '2021-03-09'],
    ]);
    expect(month.rows.map((x) => [x.from, x.to])).toEqual([
      ['2021-02-24', '2021-02-28'],
      ['2021-03-01', '2021-03-09'],
    ]);
    expect(week.totals).toEqual(day.totals);
    expect(month.totals).toEqual(day.totals);
    for (const grouped of [week, month]) {
      for (const b of grouped.rows) {
        const days = day.rows.filter((d) => d.from >= b.from && d.to <= b.to);
        for (const pick of ADDITIVE) expect(pick(b)).toBe(sum(days, pick));
      }
    }
    // Invariante de §15.4: Σ filas = totales en toda cifra aditiva; derivadas sobre los totales.
    for (const pick of ADDITIVE) expect(sum(day.rows, pick)).toBe(pick(day.totals));
    expect(day.totals.avgTicketCents).toBe(Math.floor((2 * day.totals.chargedCents + day.totals.orders) / (2 * day.totals.orders)));
    // 7 días del contrato: P con ventas en 4 de 7.
    const p = await svc.report(P, NOW_MARCH);
    expect(p.rows).toHaveLength(7);
  });

  it('AN-B-7 (por HTTP de servicio): comparación con el periodo anterior del mismo largo', async () => {
    const r = await svc.report(P, NOW_MARCH);
    expect(r.previousPeriod).toEqual({ from: '2021-02-22', to: '2021-02-28' });
    expect(r.previousTotals.orders).toBe(1); // O0b
    expect(r.comparison.orders).toEqual({ diff: 5, pct: 500 });
    const empty = await svc.report({ from: '2021-03-01', to: '2021-03-02' }, NOW_MARCH);
    expect(empty.previousTotals.orders).toBe(0);
    expect(empty.comparison.orders.pct).toBeNull();
    expect(empty.comparison.avgTicketCents).toEqual({ diff: null, pct: null });
  });

  it('AN-B-8: lo más vendido — orden por net y por pieces, máx 10, `refunded` fuera, dos acabados = dos renglones', async () => {
    const now = mx('2021-05-13', 12);
    const byNet = await svc.report({ from: '2021-05-10', to: '2021-05-12', topSort: 'net' }, now);
    const key = (c: { name: string; productType: string; finish: string; pieces: number; netCents: number }) => `${c.name}|${c.productType}|${c.finish}|${c.pieces}|${c.netCents}`;
    expect(byNet.top.sort).toBe('net');
    expect(byNet.top.cards).toHaveLength(10);
    expect(byNet.top.cards.map(key)).toEqual([
      'Carta Equis|raw|normal|3|30000',
      'Carta Zeta|raw|normal|2|25000',
      'Carta Ye|raw|normal|4|20000',
      'Carta Zeta|graded|normal|1|10000',
      ...[1, 2, 3, 4, 5, 6].map((i) => `Carta W${i}|raw|normal|1|100`),
    ]);
    const byPieces = await svc.report({ from: '2021-05-10', to: '2021-05-12', topSort: 'pieces' }, now);
    expect(byPieces.top.cards.slice(0, 4).map(key)).toEqual([
      'Carta Ye|raw|normal|4|20000',
      'Carta Equis|raw|normal|3|30000',
      'Carta Zeta|raw|normal|2|25000',
      'Carta Zeta|graded|normal|1|10000',
    ]);
    // Marzo: O3 (`refunded`, Carta Ye holofoil) fuera; Carta Equis en dos acabados = dos renglones; venta sin IVA por renglón.
    const march = await svc.report(P, NOW_MARCH);
    expect(march.top.cards.map(key)).toEqual([
      'Carta Equis|raw|normal|2|20000',
      'Carta Equis|raw|reverse_holo|1|10000',
      'Carta Zeta|graded|normal|1|8000',
      'Carta Ye|raw|normal|1|5000',
      'Carta Zeta|raw|normal|1|3000',
    ]);
    expect(march.top.cards.some((c) => c.finish === 'holofoil')).toBe(false);
    expect(march.top.sealed).toEqual([{ sealedProductId: SID.sealed, name: 'Caja de Refuerzos AN', setName: 'Set Dos AN', pieces: 1, netCents: 12000 }]);
    expect(march.top.sets).toEqual([
      { setId: SID.set1, setName: 'Set Uno AN', pieces: 4, netCents: 35000 },
      { setId: SID.set2, setName: 'Set Dos AN', pieces: 3, netCents: 23000 },
    ]);
  });

  it('AN-B-9: nuevos / recurrentes; el invitado con el correo de una cuenta que ya compró es recurrente', async () => {
    const r = await svc.report(P, NOW_MARCH);
    // Llaves: A (O0 antes) y B (O0b antes) recurrentes; g1 y g2 nuevos. O8 (invitado con el correo de B) = B.
    expect(r.customers).toEqual({ new: 2, returning: 2, distinct: 4 });
    const sunday = await svc.report({ from: '2021-03-07', to: '2021-03-07' }, NOW_MARCH);
    expect(sunday.customers).toEqual({ new: 0, returning: 1, distinct: 1 });
    // CONTROL: la llave es el correo — en febrero, sin compras anteriores, A es nueva.
    const feb = await svc.report({ from: '2021-02-20', to: '2021-02-20' }, NOW_MARCH);
    expect(feb.customers).toEqual({ new: 1, returning: 0, distinct: 1 });
    expect(EMAIL.b).toMatch(/@/);
  });

  it('AN-B-11: /today = la fila de hoy del informe; comparado con el mismo día de la semana pasada completo', async () => {
    const now = mx('2021-05-12', 15);
    const t = await svc.today(now);
    const r = await svc.report({ preset: 'today' }, now);
    expect(t.today).toEqual({ day: '2021-05-12', orders: r.rows[0].orders, chargedCents: r.rows[0].chargedCents });
    expect(t.sameWeekdayLastWeek).toEqual({ day: '2021-05-05', orders: 0, chargedCents: 0 });
    expect(t.comparison.orders).toEqual({ diff: 3, pct: null });
  });
});

describe('§AN fase B — ganancia, envíos, buylist, mejores días, mezcla (Postgres real)', () => {
  it('AN-B-15 💰: Σ rows.profit/shipping = pnl() del mismo periodo, al centavo', async () => {
    const r = await svc.report(P, NOW_MARCH);
    const pnl = await admin.pnl(mxDayStart(P.from).toISOString(), new Date(mxDayStart(nextYmd(P.to)).getTime() - 1).toISOString());
    expect(sum(r.rows, (f) => f.profitCents)).toBe(pnl.profitCents);
    expect(sum(r.rows, (f) => f.shipping.chargedNetCents)).toBe(pnl.shippingRevenueCents);
    expect(sum(r.rows, (f) => f.shipping.costNetCents)).toBe(pnl.shippingCostCents);
    expect(sum(r.rows, (f) => f.shipping.adjustmentsCents)).toBe(pnl.shippingAdjustmentsCents);
    // A mano: envío O2 neto 10000 + retiro S9 15000; guía S2 8000 + ajuste 2000 (sáb).
    expect(r.totals.shipping).toEqual({ chargedNetCents: 25000, costNetCents: 10000, costMissingCount: 1, adjustmentsCents: 2000, resultNetCents: 15000 });
    expect(r.totals.profitCents).toBe(11009);
    expect(r.rows.find((x) => x.from === '2021-03-06')!.shipping.adjustmentsCents).toBe(2000);
    // ⛔ Las claves de #78 no viajan (ausentes, no 0).
    expect(r.totals.shipping).not.toHaveProperty('buylistRevenueCents');
    expect(r.totals.shipping).not.toHaveProperty('buylistCostCents');
  });

  it('AN-B-22 💰: resultNet = cobrado − costo del MISMO cubo; negativo si la guía cuesta más; con costo sin capturar se emite', async () => {
    const r = await svc.report(P, NOW_MARCH);
    for (const f of [...r.rows, r.totals]) expect(f.shipping.resultNetCents).toBe(f.shipping.chargedNetCents - f.shipping.costNetCents);
    const row = (d: string) => r.rows.find((x) => x.from === d)!.shipping;
    expect(row('2021-03-02')).toEqual({ chargedNetCents: 0, costNetCents: 8000, costMissingCount: 0, adjustmentsCents: 0, resultNetCents: -8000 });
    expect(row('2021-03-04')).toEqual({ chargedNetCents: 15000, costNetCents: 0, costMissingCount: 1, adjustmentsCents: 0, resultNetCents: 15000 });
    // El ajuste del sábado YA va dentro del costo: −2000, ⛔ no −4000.
    expect(row('2021-03-06')).toEqual({ chargedNetCents: 0, costNetCents: 2000, costMissingCount: 0, adjustmentsCents: 2000, resultNetCents: -2000 });
  });

  it('AN-B-16: byWeekday (7, 1 = lunes) y byHour (24, hora MX) suman los totales', async () => {
    const r = await svc.report(P, NOW_MARCH);
    expect(r.bestDays.byWeekday.map((x) => x.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r.bestDays.byHour).toHaveLength(24);
    for (const list of [r.bestDays.byWeekday, r.bestDays.byHour]) {
      expect(list.reduce((a, x) => a + x.orders, 0)).toBe(r.totals.orders);
      expect(list.reduce((a, x) => a + x.chargedCents, 0)).toBe(r.totals.chargedCents);
    }
    expect(r.bestDays.byWeekday[0]).toEqual({ weekday: 1, orders: 3, chargedCents: 60601 });
    expect(r.bestDays.byHour[23]).toEqual({ hour: 23, orders: 1, chargedCents: 36300 }); // O2, 23:30 MX (05:30 UTC)
    expect(r.bestDays.byHour[0]).toEqual({ hour: 0, orders: 1, chargedCents: 24100 }); // O4, 00:10 MX
  });

  it('AN-B-17: buylist pagado por día de `paidAt`; `payoutNetCents = null` ⇒ paidWithoutPayoutCount, ⛔ no 0 silencioso', async () => {
    const r = await svc.report(P, NOW_MARCH);
    const row = (d: string) => r.rows.find((x) => x.from === d)!.buylist;
    expect(row('2021-03-05')).toEqual({ paidCount: 1, paidNetCents: 40000, paidWithoutPayoutCount: 0 });
    expect(row('2021-03-06')).toEqual({ paidCount: 1, paidNetCents: 0, paidWithoutPayoutCount: 1 });
    expect(r.totals.buylist).toEqual({ paidCount: 2, paidNetCents: 40000, paidWithoutPayoutCount: 1 });
  });

  it('AN-B-21 💰: mezcla por tipo — Σ netCents = totals.netSalesCents al centavo, Σ pieces = totals.pieces, con `refunded` dentro', async () => {
    const r = await svc.report(P, NOW_MARCH);
    const t = r.mix.byProductType;
    expect(t.raw.netCents + t.graded.netCents + t.sealed.netCents).toBe(r.totals.netSalesCents);
    expect(t.raw.pieces + t.graded.pieces + t.sealed.pieces).toBe(r.totals.pieces);
    // O3 (`refunded`, raw) SÍ cuenta aquí (a diferencia de `top`); O4 (EXCL) 20000 se reparte 12000 / 8000.
    expect(t).toEqual({
      raw: { pieces: 1 + 1 + 2 + 1 + 1, netCents: 10000 + 10001 + 20000 + 5000 + 3000 },
      graded: { pieces: 1, netCents: 8000 },
      sealed: { pieces: 1, netCents: 12000 },
    });
    // Las otras mezclas suman los totales; el método de pago (fase C) ⛔ no viaja.
    const m = r.mix;
    expect(m.byDestination.vault.orders + m.byDestination.direct_ship.orders).toBe(r.totals.orders);
    expect(m.byBuyer.account.chargedCents + m.byBuyer.guest.chargedCents).toBe(r.totals.chargedCents);
    expect(m).not.toHaveProperty('byPaymentMethod');
    expect(r).not.toHaveProperty('chargebacksUndatedCount');
    expect(r.totals).not.toHaveProperty('chargebacks');
  });

  it('AN-B-21 💰 (el ejemplo del contrato): INCL raw/graded/sealed de 100.00 ⇒ 8621 + 8621 + 8620 = 25862', async () => {
    const id = (n: number) => `a1e5a1e5-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const orderId = id(700);
    try {
      await w.h.prisma.order.create({
        data: { id: orderId, userId: SID.userA, status: 'settled', settledAt: mx('2021-04-20', 12), priceConvention: 'IVA_INCLUSIVE', subtotalCents: 30000, ivaCents: 4138, processingFeeCents: 0, totalCents: 30000, ivaRatePct: 16 },
      });
      const items: Array<['raw' | 'graded' | 'sealed', string]> = [['raw', id(701)], ['graded', id(702)], ['sealed', id(703)]];
      for (const [pt, oiId] of items) {
        const inv = await w.h.prisma.inventoryItem.create({
          data: { folio: `AN-FIX-B21-${pt}`, cardId: SID.cardX, productType: pt, acquisitionType: 'compra', status: 'in_custody', ...(pt === 'sealed' ? { sealedSubtype: 'box' } : pt === 'graded' ? { gradingCompany: 'PSA', gradeValue: '9' } : { rawCondition: 'NM' }) } as never,
        });
        await w.h.prisma.orderItem.create({ data: { id: oiId, orderId, inventoryItemId: inv.id, cardSnapshot: {}, unitPriceCents: 10000 } });
      }
      const r = await svc.report({ from: '2021-04-20', to: '2021-04-20' }, mx('2021-04-21', 12));
      expect(r.totals.netSalesCents).toBe(25862);
      expect(r.mix.byProductType).toEqual({ raw: { pieces: 1, netCents: 8621 }, graded: { pieces: 1, netCents: 8621 }, sealed: { pieces: 1, netCents: 8620 } });
    } finally {
      await w.h.prisma.orderItem.deleteMany({ where: { orderId } });
      await w.h.prisma.order.deleteMany({ where: { id: orderId } });
      await w.h.prisma.inventoryItem.deleteMany({ where: { folio: { startsWith: 'AN-FIX-B21-' } } });
    }
  });

  it('AN-B-18: el resumen de las 08:00 trae la fila de ayer (misma dayFigures); sin avisos y con pedidos ⇒ se manda; sin ambos ⇒ empty', async () => {
    w.mail.reset();
    // Domingo 2021-03-07: O8 (1 pedido, 3680), sin avisos ⇒ se manda.
    const row = (await svc.report({ from: '2021-03-07', to: '2021-03-07' }, NOW_MARCH)).rows[0];
    const res = await w.h.app.get(SpendDigestService).run({ now: mx('2021-03-08', 8) });
    expect(res).toEqual({ day: '2021-03-07', status: 'sent', alertCount: 0 });
    expect(w.mail.sent.length).toBeGreaterThan(0);
    const mine = w.mail.sent.filter((m) => m.to === w.owner.email);
    expect(mine).toHaveLength(1);
    expect(row).toMatchObject({ orders: 1, chargedCents: 3680, avgTicketCents: 3680 });
    expect(mine[0].text).toContain(`Ventas de ayer: ${row.orders} pedido · MX$36.80 · ticket MX$36.80`);
    expect(mine[0].html).toContain('Ventas de ayer');
    // Miércoles 2021-03-03: sin avisos y sin pedidos (solo un reembolso) ⇒ `empty`, sin correo.
    w.mail.reset();
    const empty = await w.h.app.get(SpendDigestService).run({ now: mx('2021-03-04', 8) });
    expect(empty).toEqual({ day: '2021-03-03', status: 'empty', alertCount: 0 });
    expect(w.mail.sent).toHaveLength(0);
  });
});

describe('§AN por HTTP — permisos, CSV, errores', () => {
  const get = (path: string, token: string) => w.h.api('GET', path, { token });

  it('AN-B-12: vault_operator ⇒ 403 en los tres; super_admin ⇒ 200; no-store', async () => {
    for (const path of ['/admin/reports/sales', '/admin/reports/sales/export.csv', '/admin/reports/sales/today']) {
      expect((await get(path, w.op.token)).status).toBe(403);
      const ok = await get(path, w.owner.token);
      expect(ok.status).toBe(200);
      expect(String(ok.headers['cache-control'])).toContain('no-store');
    }
    expect((await w.h.api('GET', '/admin/reports/sales', {})).status).toBe(401);
  });

  it('AN-B-10: CSV = rows celda a celda en PESOS (enteros exactos) + total; sin datos de cliente (CONTROL: la fixture los tiene)', async () => {
    const q = `from=${P.from}&to=${P.to}&groupBy=day`;
    const json = await get(`/admin/reports/sales?${q}`, w.owner.token);
    const csv = await get(`/admin/reports/sales/export.csv?${q}`, w.owner.token);
    expect(csv.status).toBe(200);
    expect(String(csv.headers['content-type'])).toBe('text/csv; charset=utf-8');
    expect(String(csv.headers['content-disposition'])).toBe(`attachment; filename="ventas_${P.from}_${P.to}_day.csv"`);
    const lines = csv.text.trim().split('\n').map((l) => l.split(','));
    expect(lines[0]).toEqual([
      'from', 'to', 'orders', 'chargedMxn', 'netSalesMxn', 'refundsCount', 'refundsAmountMxn', 'refundsNetMxn', 'netSalesAfterRefundsMxn',
      'pieces', 'avgTicketMxn', 'piecesPerOrder', 'shippingChargedNetMxn', 'shippingCostNetMxn', 'shippingResultNetMxn',
      'shippingCostMissingCount', 'buylistPaidCount', 'buylistPaidNetMxn', 'profitMxn',
    ]);
    const body = json.body as { rows: Array<SalesFigures & { from: string; to: string }>; totals: SalesFigures };
    const expectRow = (cells: string[], from: string, to: string, f: SalesFigures) => {
      const money = (cell: string, cents: number | null) => {
        if (cents === null) return expect(cell).toBe('');
        expect(cell).toMatch(/^-?\d+\.\d{2}$/);
        expect(Number(cell.replace('.', ''))).toBe(cents);
      };
      const count = (cell: string, n: number | null) => expect(cell).toBe(n === null ? '' : String(n));
      expect(cells.slice(0, 2)).toEqual([from, to]);
      count(cells[2], f.orders);
      money(cells[3], f.chargedCents);
      money(cells[4], f.netSalesCents);
      count(cells[5], f.refunds.count);
      money(cells[6], f.refunds.amountCents);
      money(cells[7], f.refunds.netCents);
      money(cells[8], f.netSalesAfterRefundsCents);
      count(cells[9], f.pieces);
      money(cells[10], f.avgTicketCents);
      count(cells[11], f.piecesPerOrder);
      money(cells[12], f.shipping.chargedNetCents);
      money(cells[13], f.shipping.costNetCents);
      money(cells[14], f.shipping.resultNetCents);
      count(cells[15], f.shipping.costMissingCount);
      count(cells[16], f.buylist.paidCount);
      money(cells[17], f.buylist.paidNetCents);
      money(cells[18], f.profitCents);
    };
    expect(lines).toHaveLength(1 + body.rows.length + 1);
    body.rows.forEach((row, i) => expectRow(lines[i + 1], row.from, row.to, row));
    expectRow(lines[lines.length - 1], 'total', '', body.totals);
    // Un día con venta neta negativa sale con su signo («-100.01»).
    expect(lines.find((l) => l[0] === '2021-03-03')![8]).toBe('-100.01');
    // ⛔ Datos de cliente. CONTROL: la fixture sí los tiene.
    const fixture = await w.h.prisma.order.findUnique({ where: { id: SID.o2 }, select: { guestEmail: true, orderNumber: true } });
    const userA = await w.h.prisma.user.findUnique({ where: { id: SID.userA }, select: { name: true } });
    expect(fixture!.guestEmail).toContain('@');
    expect(fixture!.orderNumber).toBeTruthy();
    expect(csv.text).not.toContain('@');
    expect(csv.text).not.toContain(fixture!.orderNumber!);
    expect(csv.text).not.toContain(userA!.name);
    expect(csv.text).not.toContain('Carta');
  });

  it('AN-B-14 (por HTTP): 400 VALIDATION_ERROR con field/allowed y sin value', async () => {
    const r = await get('/admin/reports/sales?groupBy=year', w.owner.token);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details).toEqual({ field: 'groupBy', allowed: ['day', 'week', 'month'] });
    const solo = await get('/admin/reports/sales?from=2021-03-01', w.owner.token);
    expect(solo.status).toBe(400);
    expect(solo.body.error.details).toEqual({ field: 'to' });
  });
});
