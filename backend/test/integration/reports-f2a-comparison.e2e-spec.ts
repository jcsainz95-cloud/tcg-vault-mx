/**
 * reports-f2a-comparison.e2e-spec.ts — 💰 §REPORTES-CEO F2a (API_CONTRACT_REPORTES §2) con Postgres REAL y la fixture de ventas
 * (`helpers/sales-db.ts`, feb–mar 2021): importes ≠ 0 y DISTINTOS entre el periodo y su tramo anterior.
 *
 * Qué amarra (candados que un Prisma vacío no ve):
 *  - `GET /admin/finance/pnl` → `comparison.figures` (las 8 cifras, al centavo) contra DOS lecturas independientes del P&L
 *    (`pnl()` + `ivaReport()` + `buildStatement`) y contra literales calculados a mano de la fixture; `previous` = el P&L de ese rango.
 *  - Ventas por el servicio real: `previousPeriod.clamped`, `firstDataDay`, `comparison.basis/dataSince`.
 * `firstDataDay` es `MIN(settledAt)` de TODA la base (otras suites siembran fechas propias), así que el origen se fija de dos
 * maneras: (1) sin tocar nada se compara con una lectura independiente del mínimo; (2) para `complete/partial/none` se controla
 * SOLO esa agregación (`order.aggregate` con `_min.settledAt`); el dinero sale siempre de Postgres.
 * ⚠️ Casos de borde que el arquitecto puede ajustar (clamped del 31-mar, `kind=day` > 7 días, origen de `firstDataDay`): están
 * aislados en los `it` marcados «BORDE».
 */
import { E2EHarness } from './helpers/e2e-app';
import { cleanupSales, seedSales } from './helpers/sales-db';
import { AdminService } from '../../src/modules/admin/admin.service';
import { buildStatement } from '../../src/modules/admin/pnl-core';
import { SalesAnalyticsService } from '../../src/modules/sales-analytics/sales-analytics.service';
import { toMexicoCityDateKey } from '../../src/common/business-days';

const NOW = new Date('2021-03-08T18:00:00.000Z');
const FIGURES = ['salesCents', 'returnsAndRefundsCents', 'netRevenueCents', 'cogsCents', 'stripeFeesCents', 'shippingCostCents', 'grossMarginCents', 'netResultCents'] as const;

describe('§REPORTES-CEO F2a — la comparación con dinero real (Postgres)', () => {
  let h: E2EHarness;
  let admin: AdminService;
  let sales: SalesAnalyticsService;
  let aggSpy: jest.SpyInstance | undefined;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedSales(h.prisma);
    admin = h.app.get(AdminService);
    sales = h.app.get(SalesAnalyticsService);
  }, 120000);

  afterAll(async () => {
    jest.restoreAllMocks();
    if (h) await cleanupSales(h.prisma);
    await h?.close();
  });

  afterEach(() => {
    aggSpy?.mockRestore();
    aggSpy = undefined;
  });

  /** Fija SOLO `MIN(settledAt)` (el origen de `firstDataDay`); todo lo demás va a Postgres. */
  function pinFirstSettledAt(at: Date | null) {
    aggSpy?.mockRestore();
    const orig = h.prisma.order.aggregate.bind(h.prisma.order) as (a: any) => Promise<any>;
    aggSpy = jest.spyOn(h.prisma.order, 'aggregate');
    aggSpy.mockImplementation(((args: any) =>
      args?._min?.settledAt ? Promise.resolve({ _min: { settledAt: at } }) : orig(args)) as never);
  }

  /** Lectura independiente del P&L de un rango, con las mismas piezas públicas que el reporte. */
  async function reading(from: string, to: string) {
    const [p, iva] = await Promise.all([admin.pnl(from, to), admin.ivaReport(from, to)]);
    return { p, statement: buildStatement(p, iva) };
  }
  const figuresOf = (s: ReturnType<typeof buildStatement>) => ({
    salesCents: s.salesCents,
    returnsAndRefundsCents: s.returnsAndRefunds.totalCents,
    netRevenueCents: s.netRevenueCents,
    cogsCents: s.costOfSales.cogsCents,
    stripeFeesCents: s.costOfSales.stripeFeesCents,
    shippingCostCents: s.costOfSales.shippingCostCents,
    grossMarginCents: s.grossMarginCents,
    netResultCents: s.netResultCents,
  });
  /** Round half away from zero, escrito aparte del código de producción. */
  const bps = (d: number, prev: number) => {
    if (prev === 0) return null;
    const x = (d * 10000) / Math.abs(prev);
    return Math.sign(x) * Math.round(Math.abs(x));
  };

  async function checkAgainstTwoReadings(from: string, to: string, kind: any, prevFrom: string, prevTo: string) {
    const r: any = await admin.pnlReport(from, to, kind);
    const cur = figuresOf((await reading(from, to)).statement);
    const prevReading = await reading(prevFrom, prevTo);
    const prev = figuresOf(prevReading.statement);
    expect(r.previousPeriod).toMatchObject({ from: prevFrom, to: prevTo });
    for (const k of FIGURES) {
      expect(r.comparison.figures[k]).toEqual({
        cents: cur[k],
        previousCents: prev[k],
        deltaCents: cur[k] - prev[k],
        deltaBps: bps(cur[k] - prev[k], prev[k]),
      });
    }
    // `previous` = el P&L de ese rango (plano + statement), sin `stripeFee*`/`feeIncludedSince`/anidados.
    expect(r.previous).toEqual({ ...prevReading.p, statement: prevReading.statement });
    return { r, cur, prev };
  }

  it('semana 1–7 mar (span) vs 22–28 feb: 8 cifras al centavo contra dos lecturas y contra literales de la fixture', async () => {
    pinFirstSettledAt(new Date('2021-01-05T12:00:00Z'));
    const { r, cur, prev } = await checkAgainstTwoReadings('2021-03-01', '2021-03-07', undefined, '2021-02-22', '2021-02-28');
    expect(r.period).toEqual({ from: '2021-03-01', to: '2021-03-07', kind: 'span', days: 7, timezone: 'America/Mexico_City' });
    // Tramo anterior = solo O0b (9 000, costo 4 000, comisión 450); sin envío, sin devoluciones.
    expect(prev).toEqual({ salesCents: 9000, returnsAndRefundsCents: 0, netRevenueCents: 9000, cogsCents: 4000, stripeFeesCents: 450, shippingCostCents: 0, grossMarginCents: 4550, netResultCents: 4550 });
    // Periodo = instantánea AN-B-13 (03-01..03-07 MX): ingreso 63 001 + envío cobrado 25 000; costo 36 000; comisión 4 400; ganancia −12 142.
    expect(cur.salesCents).toBe(63001 + 25000);
    expect(cur.cogsCents).toBe(36000);
    expect(cur.stripeFeesCents).toBe(4400);
    expect(cur.netResultCents).toBe(-12142);
    expect(r.comparison.figures.netResultCents).toEqual({ cents: -12142, previousCents: 4550, deltaCents: -16692, deltaBps: -36686 });
    expect(r.comparison.figures.salesCents.deltaCents).toBe(88001 - 9000);
  });

  it('mes cerrado marzo vs febrero completo (kind=month): importes distintos, mismas dos lecturas', async () => {
    pinFirstSettledAt(new Date('2021-01-05T12:00:00Z'));
    const { r, prev } = await checkAgainstTwoReadings('2021-03-01', '2021-03-31', 'month', '2021-02-01', '2021-02-28');
    expect(r.period.kind).toBe('month');
    expect(r.previousPeriod.clamped).toBe(false);
    // Febrero = O0 (7 000, costo 3 000) + O0b (9 000, costo 4 000).
    expect(prev.salesCents).toBe(16000);
    expect(prev.cogsCents).toBe(7000);
  });

  it('mes a la fecha (1–7 mar, kind=month) vs 1–7 feb sin ventas: anterior 0 ⇒ deltaBps null en todas', async () => {
    pinFirstSettledAt(new Date('2021-01-05T12:00:00Z'));
    const { r, prev } = await checkAgainstTwoReadings('2021-03-01', '2021-03-07', 'month', '2021-02-01', '2021-02-07');
    expect(prev.salesCents).toBe(0);
    for (const k of FIGURES) expect(r.comparison.figures[k].deltaBps).toBeNull();
  });

  it('BORDE: periodo a caballo de 2020 se lee desde 2020-01-01 y no revienta', async () => {
    const r: any = await admin.pnlReport('2020-01-20', '2020-02-10');
    expect(r.previousPeriod).toEqual({ from: '2019-12-29', to: '2020-01-19', clamped: false });
    expect(r.comparison).not.toBeNull();
  });

  describe('basis / dataSince / firstDataDay del P&L (tramo anterior 22–28 feb)', () => {
    const run = async (first: Date | null) => {
      pinFirstSettledAt(first);
      return (await admin.pnlReport('2021-03-01', '2021-03-07')) as any;
    };
    it('complete: primer dato ≤ inicio del tramo anterior', async () => {
      expect((await run(new Date('2021-02-22T07:00:00Z'))).comparison).toMatchObject({ basis: 'complete', dataSince: null });
    });
    it('partial con dataSince: el primer dato cae dentro del tramo anterior', async () => {
      expect((await run(new Date('2021-02-25T18:00:00Z'))).comparison).toMatchObject({ basis: 'partial', dataSince: '2021-02-25' });
    });
    it('none: el tramo anterior termina antes del primer dato, y sin pedidos', async () => {
      expect((await run(new Date('2021-03-01T18:00:00Z'))).comparison).toMatchObject({ basis: 'none', dataSince: null });
      expect((await run(null)).comparison).toMatchObject({ basis: 'none', dataSince: null });
    });
  });

  describe('Ventas por el servicio real', () => {
    it('firstDataDay = día MX del MIN(settledAt) de toda la base (lectura independiente)', async () => {
      const min = await h.prisma.order.aggregate({ where: { settledAt: { not: null } }, _min: { settledAt: true } });
      const expected = min._min.settledAt ? toMexicoCityDateKey(min._min.settledAt) : null;
      const r = await sales.report({ from: '2021-03-01', to: '2021-03-07' }, NOW);
      expect(expected).not.toBeNull();
      expect(r.firstDataDay).toBe(expected);
      expect(r.firstDataDay! <= '2021-02-20').toBe(true); // O0 de la fixture existe
    });

    it('basis complete / partial con dataSince / none; nunca un delta sin basis', async () => {
      const q = { from: '2021-03-01', to: '2021-03-07' }; // anterior 22–28 feb
      pinFirstSettledAt(new Date('2021-02-10T12:00:00Z'));
      let r = await sales.report(q, NOW);
      expect(r.firstDataDay).toBe('2021-02-10');
      expect(r.comparison).toMatchObject({ basis: 'complete', dataSince: null });
      pinFirstSettledAt(new Date('2021-02-25T18:00:00Z'));
      r = await sales.report(q, NOW);
      expect(r.comparison).toMatchObject({ basis: 'partial', dataSince: '2021-02-25' });
      pinFirstSettledAt(new Date('2021-03-02T18:00:00Z'));
      r = await sales.report(q, NOW);
      expect(r.comparison).toMatchObject({ basis: 'none', dataSince: null });
      pinFirstSettledAt(null);
      r = await sales.report(q, NOW);
      expect(r.firstDataDay).toBeNull();
      expect(r.comparison.basis).toBe('none');
    });

    it('sin kind todo igual: previousPeriod span 22–28 feb, clamped false; con kind=month a la fecha, 1–7 feb', async () => {
      pinFirstSettledAt(new Date('2021-01-05T12:00:00Z'));
      const a = await sales.report({ from: '2021-03-01', to: '2021-03-07' }, NOW);
      expect(a.period.kind).toBe('span');
      expect(a.previousPeriod).toEqual({ from: '2021-02-22', to: '2021-02-28', clamped: false });
      expect(a.previousTotals.orders).toBe(1); // O0b
      const b = await sales.report({ from: '2021-03-01', to: '2021-03-07', kind: 'month' }, NOW);
      expect(b.period.kind).toBe('month');
      expect(b.previousPeriod).toEqual({ from: '2021-02-01', to: '2021-02-07', clamped: false });
      // kind que no calza con su unidad ⇒ `period.kind` EFECTIVO span
      const c = await sales.report({ from: '2021-03-03', to: '2021-03-07', kind: 'month' }, NOW);
      expect(c.period.kind).toBe('span');
      expect(b.previousTotals.orders).toBe(0);
    });

    it('BORDE: 30-mar vs el 30-feb que no existe ⇒ 28-feb y clamped:true (O0 + O0b)', async () => {
      pinFirstSettledAt(new Date('2021-01-05T12:00:00Z'));
      const r = await sales.report({ from: '2021-03-01', to: '2021-03-30', kind: 'month' }, new Date('2021-04-01T18:00:00.000Z'));
      expect(r.previousPeriod).toEqual({ from: '2021-02-01', to: '2021-02-28', clamped: true });
      expect(r.previousTotals.orders).toBe(2);
    });
  });
});
