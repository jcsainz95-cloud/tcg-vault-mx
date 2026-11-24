/**
 * reports-finance.calendar.spec.ts — §REPORTES-CEO F2b §3b (CR-17..21, M-4): los bordes de los consolidados de calendario con el
 * dial `fiscal_year_start_month` (1, 4, 12; 0, 13, "x", 2.5 y ausente ⇒ 1), `toDate`, el tramo anterior (misma fecha de calendario,
 * `clamped`) y la validación de `count`/`asOf`. BD simulada vacía: aquí solo se mide el CALENDARIO, el dinero lo miden las demás.
 */
import { ReportsFinanceService } from '../src/modules/admin/reports-finance.service';
import { isToDate, previousRange } from '../src/modules/sales-analytics/sales-period';

function svc(dial?: unknown, firstSettled: Date | null = new Date('2020-01-15T12:00:00Z')) {
  const empty = async () => [];
  const prisma: any = {
    configSetting: { findUnique: async () => (dial === undefined ? null : { valueJson: dial }), findMany: empty },
    order: { findMany: empty, aggregate: async () => ({ _min: { settledAt: firstSettled } }) },
    orderItem: { findMany: empty },
    shipmentRequest: { findMany: empty },
    shipmentCostAdjustment: { findMany: empty },
    paymentRefund: { findMany: empty },
    manualRefund: { findMany: empty },
    sellRequest: { findMany: empty },
  };
  return new ReportsFinanceService(prisma, null as never);
}
const NOW = new Date('2026-11-24T18:00:00Z');
const spans = async (dial: unknown, unit: any, count: number, asOf = '2026-11-24', now = NOW) => {
  const r: any = await svc(dial).series({ groupBy: unit, count, asOf }, now);
  return r.buckets.map((b: any) => `${b.from}..${b.to}${b.toDate ? '*' : ''}`);
};

describe('consolidados de calendario (§3b)', () => {
  it('dial 1 (ausente) — año calendario: mes, trimestre, semestre y año; el último = en curso «a la fecha» (*)', async () => {
    expect(await spans(undefined, 'month', 2)).toEqual(['2026-09-01..2026-09-30', '2026-10-01..2026-10-31', '2026-11-01..2026-11-24*']);
    expect(await spans(undefined, 'quarter', 1)).toEqual(['2026-07-01..2026-09-30', '2026-10-01..2026-11-24*']);
    expect(await spans(undefined, 'semester', 1)).toEqual(['2026-01-01..2026-06-30', '2026-07-01..2026-11-24*']);
    expect(await spans(undefined, 'year', 1)).toEqual(['2025-01-01..2025-12-31', '2026-01-01..2026-11-24*']);
  });

  it('dial 4 (el año empieza en abril): T = Abr-Jun, Jul-Sep, Oct-Dic, Ene-Mar; S = Abr-Sep, Oct-Mar; año = Abr..Mar', async () => {
    expect(await spans(4, 'quarter', 1)).toEqual(['2026-07-01..2026-09-30', '2026-10-01..2026-11-24*']);
    expect(await spans(4, 'quarter', 1, '2026-02-10')).toEqual(['2025-10-01..2025-12-31', '2026-01-01..2026-02-10*']);
    expect(await spans(4, 'semester', 1)).toEqual(['2026-04-01..2026-09-30', '2026-10-01..2026-11-24*']);
    expect(await spans(4, 'semester', 1, '2026-02-10')).toEqual(['2025-04-01..2025-09-30', '2025-10-01..2026-02-10*']);
    expect(await spans(4, 'year', 1)).toEqual(['2025-04-01..2026-03-31', '2026-04-01..2026-11-24*']);
    expect(await spans(4, 'year', 1, '2026-02-10')).toEqual(['2024-04-01..2025-03-31', '2025-04-01..2026-02-10*']);
  });

  it('dial 12 (el año empieza en diciembre): T = Dic-Feb… Sep-Nov; S = Dic-May, Jun-Nov; año = Dic..Nov; el 30-nov ya es cerrado', async () => {
    expect(await spans(12, 'quarter', 1)).toEqual(['2026-06-01..2026-08-31', '2026-09-01..2026-11-24*']);
    expect(await spans(12, 'semester', 1)).toEqual(['2025-12-01..2026-05-31', '2026-06-01..2026-11-24*']);
    expect(await spans(12, 'year', 1)).toEqual(['2024-12-01..2025-11-30', '2025-12-01..2026-11-24*']);
    // 30-nov = último día del año fiscal ⇒ periodo CERRADO: sin «a la fecha»
    expect(await spans(12, 'year', 1, '2026-11-30', new Date('2026-12-01T18:00:00Z'))).toEqual(['2024-12-01..2025-11-30', '2025-12-01..2026-11-30']);
  });

  it.each([[0], [13], ['x'], [2.5], [null], [-1], ['4']])('dial inválido %p ⇒ 1', async (bad) => {
    const r: any = await svc(bad).series({ groupBy: 'quarter', count: 1, asOf: '2026-11-24' }, NOW);
    expect(r.fiscalYearStartMonth).toBe(1);
    expect(r.buckets[1].from).toBe('2026-10-01');
  });

  it('forma: asOf/fiscalYearStartMonth/unit, count+1 cubos del más antiguo al más reciente, solo el último con toDate', async () => {
    const r: any = await svc(4).series({ groupBy: 'month', count: 12, asOf: '2026-11-24' }, NOW);
    expect(r).toMatchObject({ asOf: '2026-11-24', fiscalYearStartMonth: 4, unit: 'month' });
    expect(r.buckets).toHaveLength(13);
    expect(r.buckets.map((b: any) => b.toDate)).toEqual([...Array(12).fill(false), true]);
    expect(r.buckets[0]).toMatchObject({ from: '2025-11-01', to: '2025-11-30', kind: 'month', days: 30 });
    expect(Object.keys(r.buckets[0].own)).toEqual(['sealed', 'raw', 'graded', 'accessory', 'unassigned', 'total']);
    expect(r.buckets[0].total).toEqual(r.buckets[0].own.total);
    expect(Object.keys(r.buckets[0].comparison)).toEqual(['basis', 'dataSince', 'previous', 'total', 'byLine']);
    expect(Object.keys(r.buckets[0].comparison.byLine)).toEqual(['sealed', 'raw', 'graded', 'accessory', 'unassigned']);
    expect(r.buckets[0].total.fixedCostsCents).toBeNull();
    expect(r.buckets[0].own.sealed).not.toHaveProperty('fixedCostsCents');
  });

  it('CR-20: misma fecha de calendario — 31-mar (cerrado) vs feb completo clamped:false; 30-mar-2027 vs 28-feb clamped:true; 2028-03-01 vs 2027-03-01', async () => {
    const prev = async (asOf: string, unit: any = 'month') => ((await svc().series({ groupBy: unit, count: 1, asOf }, new Date('2030-01-01T12:00:00Z'))) as any).buckets[1].comparison.previous;
    expect(await prev('2027-03-31')).toEqual({ from: '2027-02-01', to: '2027-02-28', clamped: false });
    expect(await prev('2027-03-30')).toEqual({ from: '2027-02-01', to: '2027-02-28', clamped: true });
    expect(await prev('2028-03-29')).toEqual({ from: '2028-02-01', to: '2028-02-29', clamped: false });
    expect(await prev('2028-03-01')).toEqual({ from: '2028-02-01', to: '2028-02-01', clamped: false });
    expect(await prev('2026-11-24', 'quarter')).toEqual({ from: '2026-07-01', to: '2026-08-24', clamped: false });
  });

  it('basis: tienda nueva ⇒ none/partial/complete según firstDataDay (nunca un delta sin basis)', async () => {
    const r: any = await svc(undefined, new Date('2026-10-10T12:00:00Z')).series({ groupBy: 'month', count: 2, asOf: '2026-11-24' }, NOW);
    expect(r.buckets.map((b: any) => b.comparison.basis)).toEqual(['none', 'none', 'partial']);
    expect(r.buckets[2].comparison.dataSince).toBe('2026-10-10');
    const none: any = await svc(undefined, null).series({ groupBy: 'month', count: 1, asOf: '2026-11-24' }, NOW);
    expect(none.buckets.map((b: any) => b.comparison.basis)).toEqual(['none', 'none']);
  });

  it('validación: count fuera de 1..12 ⇒ 400; asOf futuro ⇒ 400; asOf inexistente ⇒ 422; count por defecto 4 (5 cubos)', async () => {
    const run = (q: any) => svc().series({ groupBy: 'month', ...q }, NOW);
    for (const count of [0, 13, '0', 'x', '2.5', -1]) await expect(run({ count })).rejects.toMatchObject({ status: 400 });
    await expect(run({ asOf: '2026-11-25' })).rejects.toMatchObject({ status: 400 });
    await expect(run({ asOf: '2026-02-30' })).rejects.toMatchObject({ status: 422 });
    await expect(run({ asOf: '2026-2-3' })).rejects.toMatchObject({ status: 400 });
    expect(((await run({})) as any).buckets).toHaveLength(5);
    expect(((await run({ count: '12' })) as any).buckets).toHaveLength(13);
  });

  it('día/semana: groupBy=day > 366 días ⇒ 400; sin from/to ⇒ 400; from > to ⇒ 422; fecha inexistente ⇒ 422', async () => {
    const run = (q: any) => svc().series(q, NOW);
    await expect(run({ groupBy: 'day', from: '2025-01-01', to: '2026-01-02' })).rejects.toMatchObject({ status: 400 });
    expect(((await run({ groupBy: 'week', from: '2025-01-01', to: '2026-01-02' })) as any).buckets.length).toBeGreaterThan(50);
    await expect(run({ groupBy: 'day' })).rejects.toMatchObject({ status: 400 });
    await expect(run({ groupBy: 'day', from: '2026-03-02', to: '2026-03-01' })).rejects.toMatchObject({ status: 422 });
    await expect(run({ groupBy: 'day', from: '2026-02-30', to: '2026-03-01' })).rejects.toMatchObject({ status: 422 });
    await expect(run({ groupBy: 'day', from: '2026-03-01' })).rejects.toMatchObject({ status: 400 });
    const r: any = await run({ groupBy: 'day', from: '2026-03-01', to: '2026-03-03' });
    expect(r.buckets.map((b: any) => b.from)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    expect(r.total.fixedCostsCents).toBeNull();
  });
});

describe('period.toDate (m-7, M-8)', () => {
  it('último día del mes/trimestre/año = cerrado (false); antes = a la fecha (true); kind no de calendario = false', () => {
    expect(isToDate('month', '2026-11-01', '2026-11-30')).toBe(false); // 30-nov
    expect(isToDate('month', '2026-11-01', '2026-11-23')).toBe(true);
    expect(isToDate('quarter', '2026-10-01', '2026-12-31')).toBe(false);
    expect(isToDate('quarter', '2026-10-01', '2026-11-24')).toBe(true);
    expect(isToDate('semester', '2026-07-01', '2026-12-30')).toBe(true);
    expect(isToDate('year', '2026-01-01', '2026-12-31')).toBe(false);
    expect(isToDate('year', '2026-01-01', '2026-11-24')).toBe(true);
    expect(isToDate('span', '2026-11-01', '2026-11-23')).toBe(false);
    expect(isToDate(undefined, '2026-11-01', '2026-11-23')).toBe(false);
    // el `kind` EFECTIVO: un `month` que no empieza en día 1 cae a `span` ⇒ nunca a la fecha
    expect(isToDate(previousRange('month', '2026-11-05', '2026-11-23').kind, '2026-11-05', '2026-11-23')).toBe(false);
    expect(isToDate(previousRange('month', '2026-11-01', '2026-11-23').kind, '2026-11-01', '2026-11-23')).toBe(true);
  });
});
