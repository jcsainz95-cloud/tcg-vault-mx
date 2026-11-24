import { describe, it, expect, afterEach } from 'vitest';
import { mockPnl } from './fixtures';
import { mockPnlCalendar, mockPnlReport } from './pnl-lines';
import { PNL_FIGURES, PNL_LINES, type PnlColumnDTO } from '@/types/reports-pnl';

/**
 * El servidor falso de F2b debe ser FIEL al contrato (§3/§3b): forma exacta, álgebra y paridad Σ(5 columnas) = total al centavo.
 * Si el mock mintiera, las pantallas y el e2e probarían contra algo que el servidor real nunca devuelve.
 */
const KEYS: (keyof PnlColumnDTO)[] = ['grossSalesCents', 'discountsCents', 'refundsCents', 'netSalesCents', 'cogsCents', 'grossProfitCents', 'marginBps', 'sellingCosts', 'contributionCents'];
const halfAway = (x: number) => Math.sign(x) * Math.round(Math.abs(x));
const MONEY: (keyof PnlColumnDTO)[] = ['grossSalesCents', 'discountsCents', 'refundsCents', 'netSalesCents', 'cogsCents', 'grossProfitCents', 'contributionCents'];

function checkColumn(c: PnlColumnDTO) {
  expect(c.netSalesCents).toBe(c.grossSalesCents - c.discountsCents - c.refundsCents);
  expect(c.grossProfitCents).toBe(c.netSalesCents - c.cogsCents);
  expect(c.marginBps).toBe(c.netSalesCents > 0 ? halfAway((c.grossProfitCents * 10_000) / c.netSalesCents) : null);
  expect(c.contributionCents).toBe(c.grossProfitCents - c.sellingCosts.paymentFeeCents + c.sellingCosts.shippingResultCents);
  for (const k of MONEY) expect(Number.isInteger(c[k])).toBe(true);
}

afterEach(() => window.sessionStorage.clear());

describe('mock F2b · GET /admin/reports/finance/pnl', () => {
  const r = mockPnlReport({ from: '2026-11-01', to: '2026-11-30', kind: 'month' });
  it('forma exacta del contrato (claves y nulos)', () => {
    expect(Object.keys(r).sort()).toEqual(['allocationMismatchOrders', 'comparison', 'costMissingCount', 'firstDataDay', 'marketplace', 'memo', 'own', 'period', 'previous', 'previousPeriod', 'stripeFeeEstimatedOrders', 'total'].sort());
    expect(Object.keys(r.own).sort()).toEqual(['accessory', 'graded', 'raw', 'sealed', 'total', 'unassigned']);
    expect(r.marketplace).toEqual({ available: false, gmvCents: null, commissionCents: null });
    for (const l of PNL_LINES) {
      expect(Object.keys(r.own[l]).sort()).toEqual([...KEYS].sort()); // en las líneas no viajan fixedCostsCents/resultCents
    }
    expect(r.total.fixedCostsCents).toBeNull();
    expect(r.total.resultCents).toBeNull();
    expect(Object.keys(r.comparison!.byLine).sort()).toEqual([...PNL_LINES].sort());
    expect(Object.keys(r.comparison!.total).sort()).toEqual([...PNL_FIGURES].sort());
    expect(Object.keys(r.memo).sort()).toEqual(['buylist', 'chargebacks', 'inventoryPurchasesCents', 'iva', 'shipping', 'shrinkageCents']);
  });
  it('álgebra de cada columna y Σ(5 columnas) = total al centavo, en cada clave', () => {
    for (const c of [...PNL_LINES.map((l) => r.own[l]), r.total, r.previous!.total, ...PNL_LINES.map((l) => r.previous!.own[l])]) checkColumn(c);
    for (const set of [r.own, r.previous!.own]) {
      const total = set === r.own ? r.total : r.previous!.total;
      for (const k of MONEY) expect(PNL_LINES.reduce((s, l) => s + (set[l][k] as number), 0), String(k)).toBe(total[k]);
      expect(PNL_LINES.reduce((s, l) => s + set[l].sellingCosts.paymentFeeCents, 0)).toBe(total.sellingCosts.paymentFeeCents);
      expect(PNL_LINES.reduce((s, l) => s + set[l].sellingCosts.shippingResultCents, 0)).toBe(total.sellingCosts.shippingResultCents);
    }
    expect(r.own.total).toEqual(r.total);
  });
  it('un mes de 30 días cuadra con el P&L de siempre: total.contributionCents == profitCents', () => {
    expect(r.total.contributionCents).toBe(mockPnl.profitCents);
    expect(r.total.cogsCents).toBe(mockPnl.cogsCents);
    expect(r.total.sellingCosts.paymentFeeCents).toBe(mockPnl.stripeFeesCents);
  });
  it('«Sin línea» solo lleva resultado del envío (buylist); «Todo» ⇒ sin periodo ni comparación', () => {
    const u = r.own.unassigned;
    expect([u.grossSalesCents, u.discountsCents, u.refundsCents, u.cogsCents, u.sellingCosts.paymentFeeCents]).toEqual([0, 0, 0, 0, 0]);
    expect(u.marginBps).toBeNull();
    const all = mockPnlReport({});
    expect([all.period, all.previousPeriod, all.previous, all.comparison]).toEqual([null, null, null, null]);
  });
  it('periodo del servidor: toDate solo a la fecha; deltas = Delta del contrato (deltaBps entero o null)', () => {
    expect(r.period!.toDate).toBe(false); // 1–30 nov es el mes entero
    expect(mockPnlReport({ from: '2026-11-01', to: '2026-11-23', kind: 'month' }).period!.toDate).toBe(true);
    for (const f of PNL_FIGURES) {
      const d = r.comparison!.total[f];
      expect(d.deltaCents).toBe(d.cents - d.previousCents);
      expect(d.deltaBps === null || Number.isInteger(d.deltaBps)).toBe(true);
    }
  });
  it('el contador de reparto dudoso se enciende solo con la perilla del demo', () => {
    expect(r.allocationMismatchOrders).toBe(0);
    window.sessionStorage.setItem('tcg.mock.allocationMismatch', '3');
    expect(mockPnlReport({}).allocationMismatchOrders).toBe(3);
  });
});

describe('mock F2b · …/pnl/series?groupBy=month|quarter|semester|year', () => {
  it('count+1 cubos, del más antiguo al más reciente; el último es el en curso (toDate, to = asOf); forma del contrato', () => {
    const c = mockPnlCalendar({ unit: 'quarter', count: 3, asOf: '2026-11-23' });
    expect(Object.keys(c).sort()).toEqual(['asOf', 'buckets', 'fiscalYearStartMonth', 'unit']);
    expect(c.buckets).toHaveLength(4);
    expect(c.buckets.map((b) => b.from)).toEqual(['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01']);
    const last = c.buckets.at(-1)!;
    expect([last.from, last.to, last.toDate, last.days]).toEqual(['2026-10-01', '2026-11-23', true, 54]);
    expect(c.buckets.slice(0, -1).every((b) => !b.toDate)).toBe(true);
    expect(c.buckets.map((b) => b.to)).toEqual(['2026-03-31', '2026-06-30', '2026-09-30', '2026-11-23']); // fin de trimestre calendario
    for (const b of c.buckets) {
      expect(Object.keys(b).sort()).toEqual(['comparison', 'days', 'from', 'kind', 'own', 'to', 'toDate', 'total']);
      checkColumn(b.total);
      for (const k of MONEY) expect(PNL_LINES.reduce((s, l) => s + (b.own[l][k] as number), 0)).toBe(b.total[k]);
    }
  });
  it('meses, semestres y años con bordes de calendario; periodo anterior = mismo tramo (30-mar-2027 vs 28-feb, clamped)', () => {
    const m = mockPnlCalendar({ unit: 'month', count: 2, asOf: '2027-03-30' });
    const cur = m.buckets.at(-1)!;
    expect([cur.from, cur.to, cur.comparison.previous.to, cur.comparison.previous.clamped]).toEqual(['2027-03-01', '2027-03-30', '2027-02-28', true]);
    expect(m.buckets.map((b) => b.from)).toEqual(['2027-01-01', '2027-02-01', '2027-03-01']);
    const s = mockPnlCalendar({ unit: 'semester', count: 1, asOf: '2026-11-23' });
    expect(s.buckets.map((b) => [b.from, b.to])).toEqual([['2026-01-01', '2026-06-30'], ['2026-07-01', '2026-11-23']]);
    const y = mockPnlCalendar({ unit: 'year', count: 2, asOf: '2026-11-23' });
    expect(y.buckets.map((b) => b.from)).toEqual(['2024-01-01', '2025-01-01', '2026-01-01']);
    expect(y.buckets[0].to).toBe('2024-12-31');
  });
  it('tienda nueva (sin pedidos): cubos con ceros y basis none', () => {
    window.sessionStorage.setItem('tcg.mock.firstDataDay', 'none');
    const c = mockPnlCalendar({ unit: 'month', count: 2, asOf: '2026-11-23' });
    expect(c.buckets.every((b) => b.total.grossSalesCents === 0 && b.comparison.basis === 'none')).toBe(true);
  });
});
