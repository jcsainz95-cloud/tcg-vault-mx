import { afterEach, describe, expect, it } from 'vitest';
import { mockCentsToPesosCell, mockSalesCsv, mockSalesReport, mockSalesToday } from './sales';
import { ApiFixtureError } from './fixtures';
import type { SalesFiguresDTO } from '@/types/contract';

/**
 * El servidor falso de §15 tiene que cumplir las invariantes del contrato (§15.4 + AN-1.1): si no, la pantalla se
 * ejercitaría contra datos que el servidor real no puede dar. Reloj fijo (N=1, determinista).
 */
const NOW = new Date('2026-10-06T18:00:00Z'); // 12:00 en México

afterEach(() => {
  window.localStorage.removeItem('tcg.role');
  window.localStorage.removeItem('tcg.salesPhase');
});

const add = (xs: SalesFiguresDTO[], f: (x: SalesFiguresDTO) => number) => xs.reduce((a, x) => a + f(x), 0);

describe('mock §15 · invariantes', () => {
  it('Σ filas = totales; totales iguales en day/week/month; ticket sobre totales', () => {
    const day = mockSalesReport({ preset: 'last30' }, NOW);
    const week = mockSalesReport({ preset: 'last30', groupBy: 'week' }, NOW);
    const month = mockSalesReport({ preset: 'last30', groupBy: 'month' }, NOW);
    expect(day.rows).toHaveLength(30);
    expect(day.rows.some((r) => r.orders === 0)).toBe(true); // hay días en cero (y viajan)
    for (const f of [(x: SalesFiguresDTO) => x.orders, (x: SalesFiguresDTO) => x.chargedCents, (x: SalesFiguresDTO) => x.refunds.netCents, (x: SalesFiguresDTO) => x.shipping!.resultNetCents!, (x: SalesFiguresDTO) => x.chargebacks!.count]) {
      expect(add(day.rows, f)).toBe(f(day.totals));
      expect(add(week.rows, f)).toBe(f(day.totals));
    }
    expect(week.totals).toEqual(day.totals);
    expect(month.totals).toEqual(day.totals);
    expect(day.totals.avgTicketCents).toBe(Math.floor(day.totals.chargedCents / day.totals.orders + 0.5));
    expect(day.totals.shipping!.resultNetCents).toBe(day.totals.shipping!.chargedNetCents - day.totals.shipping!.costNetCents);
    const sumWd = day.bestDays!.byWeekday.reduce((a, x) => a + x.orders, 0);
    expect(sumWd).toBe(day.totals.orders);
    expect(day.bestDays!.byHour).toHaveLength(24);
    const pt = day.mix!.byProductType!;
    expect(pt.raw.pieces + pt.graded.pieces + pt.sealed.pieces).toBe(day.totals.pieces);
    expect(pt.raw.netCents + pt.graded.netCents + pt.sealed.netCents).toBe(day.totals.netSalesCents);
  });
  it('semanas lunes–domingo recortadas al periodo', () => {
    const r = mockSalesReport({ from: '2026-09-02', to: '2026-09-16', groupBy: 'week' }, NOW);
    expect(r.rows.map((x) => [x.from, x.to])).toEqual([
      ['2026-09-02', '2026-09-06'],
      ['2026-09-07', '2026-09-13'],
      ['2026-09-14', '2026-09-16'],
    ]);
    expect(r.previousPeriod).toEqual({ from: '2026-08-18', to: '2026-09-01' });
  });
  it('0 pedidos ⇒ `null`, nunca 0', () => {
    const r = mockSalesReport({ preset: 'last30' }, NOW);
    const zero = r.rows.find((x) => x.orders === 0)!;
    expect(zero.avgTicketCents).toBeNull();
    expect(zero.piecesPerOrder).toBeNull();
  });
  it('fase A: las claves P2 NO viajan (ausentes, no 0); fase B: sin contracargos ni método de pago', () => {
    window.localStorage.setItem('tcg.salesPhase', 'A');
    const a = mockSalesReport({}, NOW);
    expect('shipping' in a.totals).toBe(false);
    expect('profitCents' in a.rows[0]).toBe(false);
    expect(a.bestDays).toBeUndefined();
    expect(a.mix).toBeUndefined();
    window.localStorage.setItem('tcg.salesPhase', 'B');
    const b = mockSalesReport({}, NOW);
    expect(b.totals.shipping?.resultNetCents).toBeDefined();
    expect('chargebacks' in b.totals).toBe(false);
    expect(b.mix?.byPaymentMethod).toBeUndefined();
    expect(b.mix?.byProductType).toBeDefined();
    expect(b.chargebacksUndatedCount).toBeUndefined();
  });
});

describe('mock §15 · permisos y 400', () => {
  it('operador ⇒ 403 en el informe y en /today', () => {
    window.localStorage.setItem('tcg.role', 'vault_operator');
    expect(() => mockSalesReport({}, NOW)).toThrow(ApiFixtureError);
    expect(() => mockSalesToday(NOW)).toThrow(ApiFixtureError);
  });
  it.each([
    [{ preset: 'ayer' as never }, 'preset'],
    [{ groupBy: 'year' as never }, 'groupBy'],
    [{ from: '2026-09-01' }, 'to'],
    [{ from: '2026-09-10', to: '2026-09-01' }, 'from'],
    [{ from: '2026-09-01', to: '2026-10-07' }, 'to'],
    [{ from: '2025-01-01', to: '2026-10-01' }, 'from'],
    [{ preset: 'last7' as const, from: '2026-09-01', to: '2026-09-02' }, 'preset'],
  ])('%j ⇒ field %s, sin `value`', (params, field) => {
    try {
      mockSalesReport(params, NOW);
      throw new Error('no lanzó');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiFixtureError);
      const err = e as ApiFixtureError;
      expect(err.status).toBe(400);
      expect(err.details?.field).toBe(field);
      expect(err.details && 'value' in err.details).toBe(false);
    }
  });
});

describe('mock §15.7 · CSV en pesos (AN-1.1)', () => {
  it('centsToPesosCell con aritmética entera', () => {
    expect(mockCentsToPesosCell(34800)).toBe('348.00');
    expect(mockCentsToPesosCell(-1230)).toBe('-12.30');
    expect(mockCentsToPesosCell(5)).toBe('0.05');
    expect(mockCentsToPesosCell(123456789)).toBe('1234567.89');
  });
  it('cabecera *Mxn, una fila por cubo + total, nombre del fichero', () => {
    const { text, filename } = mockSalesCsv({ preset: 'last7' }, NOW);
    const lines = text.trim().split('\n');
    expect(lines[0].startsWith('from,to,orders,chargedMxn,netSalesMxn,')).toBe(true);
    expect(lines[0].endsWith(',chargebacksCount,chargebacksAmountMxn')).toBe(true);
    expect(lines).toHaveLength(1 + 7 + 1);
    expect(lines[8].startsWith('total,')).toBe(true);
    expect(filename).toBe('ventas_2026-09-30_2026-10-06_day.csv');
    expect(text).not.toMatch(/@|Charizard/);
  });
});
