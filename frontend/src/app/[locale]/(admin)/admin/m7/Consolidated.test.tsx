import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { expectOneDecimalPercents } from '@/test/pct';
import * as api from '@/lib/api';
import { mockPnlCalendar } from '@/lib/mock/pnl-lines';
import type { CalendarUnit, PnlCalendarDTO } from '@/types/reports-pnl';
import { Consolidated, bucketLabel } from './Consolidated';
import { money } from '../m9/salesFormat';

/** §REPORTES-CEO F2b (§3b) — Consolidados: mes → trimestre → semestre → año; el periodo en curso al final, «a la fecha». */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T18:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const serve = (over?: (c: PnlCalendarDTO) => PnlCalendarDTO) =>
  vi.spyOn(api, 'getPnlCalendar').mockImplementation(async (p) => {
    const c = mockPnlCalendar({ ...p, asOf: '2026-11-23' });
    return over ? over(c) : c;
  });

describe('F2b · Consolidados', () => {
  it('pide meses (6 completos) por defecto; la última columna es el periodo en curso, rotulado «Mes a la fecha» con los días', async () => {
    const spy = serve();
    renderWithProviders(<Consolidated />, 'es');
    const table = await screen.findByTestId('cons-table');
    expect(spy).toHaveBeenCalledWith({ unit: 'month', count: 6 });
    const heads = within(table).getAllByTestId(/^cons-head-/);
    expect(heads).toHaveLength(7);
    expect(heads.map((h) => h.getAttribute('data-todate'))).toEqual(['false', 'false', 'false', 'false', 'false', 'false', 'true']);
    const last = heads.at(-1)!;
    expect(last).toHaveTextContent('nov 2026');
    expect(last).toHaveTextContent('Mes a la fecha · 23 días transcurridos');
    expect(last).toHaveTextContent('contra 1–23 oct');
    expect(within(heads[0]).queryByTestId('cons-todate')).toBeNull();
  });

  it('cada celda es la del servidor (Total y cada línea abierta) y la variación sale del JSON', async () => {
    const cal = mockPnlCalendar({ unit: 'month', count: 6, asOf: '2026-11-23' });
    vi.spyOn(api, 'getPnlCalendar').mockResolvedValue(cal);
    renderWithProviders(<Consolidated />, 'es');
    await screen.findByTestId('cons-table');
    for (const b of cal.buckets) {
      expect(screen.getByTestId(`cons-netSales-${b.from}`)).toHaveTextContent(money(b.total.netSalesCents, 'es'));
      expect(screen.getByTestId(`cons-contribution-${b.from}`)).toHaveTextContent(money(b.total.contributionCents, 'es'));
      expect(screen.getByTestId(`cons-cogs-${b.from}`)).toHaveTextContent(money(b.total.cogsCents, 'es'));
    }
    // Las líneas están cerradas hasta que se abren; al abrir, cada una muestra SU columna del cubo.
    expect(screen.queryByTestId('cons-raw-netSales')).toBeNull();
    fireEvent.click(screen.getByTestId('cons-toggle-raw'));
    const cur = cal.buckets.at(-1)!;
    expect(screen.getByTestId(`cons-raw-netSales-${cur.from}`)).toHaveTextContent(money(cur.own.raw.netSalesCents, 'es'));
    expect(screen.getByTestId(`cons-raw-grossProfit-${cur.from}`)).toHaveTextContent(money(cur.own.raw.grossProfitCents, 'es'));
    expect(screen.getByTestId('cons-toggle-raw')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('cons-toggle-sealed')).toHaveAttribute('aria-expanded', 'false');
    expectOneDecimalPercents(screen.getByTestId('cons-table').textContent ?? '', 20);
  });

  it.each<[CalendarUnit, string, number, string]>([
    ['quarter', 'Trimestre', 4, 'T4 2026'],
    ['semester', 'Semestre', 3, 'S2 2026'],
    ['year', 'Año', 3, '2026'],
  ])('selector mes → trimestre → semestre → año: %s', async (unit, label, count, last) => {
    const spy = serve();
    renderWithProviders(<Consolidated />, 'es');
    await screen.findByTestId('cons-table');
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(screen.getByTestId('cons-table')).toHaveAttribute('data-unit', unit));
    expect(spy).toHaveBeenLastCalledWith({ unit, count });
    const heads = screen.getAllByTestId(/^cons-head-/);
    expect(heads).toHaveLength(count + 1);
    expect(heads.at(-1)).toHaveTextContent(last);
    expect(heads.at(-1)).toHaveTextContent(`${label} a la fecha`);
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
  });

  it('basis none y partial: la cabecera lo dice; clamped avisa; nunca un % sin base', async () => {
    serve((c) => {
      const b = c.buckets;
      b[0] = { ...b[0], comparison: { ...b[0].comparison, basis: 'none' } };
      b[1] = { ...b[1], comparison: { ...b[1].comparison, basis: 'partial', dataSince: '2026-05-12' } };
      const cur = b.at(-1)!;
      b[b.length - 1] = { ...cur, to: '2026-11-30', comparison: { ...cur.comparison, previous: { ...cur.comparison.previous, to: '2026-10-31', clamped: true } } };
      return c;
    });
    renderWithProviders(<Consolidated />, 'es');
    const table = await screen.findByTestId('cons-table');
    const heads = within(table).getAllByTestId(/^cons-head-/);
    expect(heads[0]).toHaveTextContent('sin periodo anterior para comparar');
    expect(within(table).getByTestId(`cons-netSales-${heads[0].getAttribute('data-testid')!.replace('cons-head-', '')}`).textContent).not.toMatch(/%/);
    expect(heads[1]).toHaveTextContent('contra lo que hay desde 12 may 2026');
    expect(heads.at(-1)).toHaveTextContent('no tiene día 30');
  });

  it('en inglés: etiquetas, «to date» y trimestre «Q»', async () => {
    serve();
    renderWithProviders(<Consolidated />, 'en');
    await screen.findByTestId('cons-table');
    expect(screen.getByRole('heading', { name: 'Consolidated' })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^cons-head-/).at(-1)).toHaveTextContent('Month to date · 23 days so far');
    fireEvent.click(screen.getByRole('button', { name: 'Quarter' }));
    await waitFor(() => expect(screen.getByTestId('cons-table')).toHaveAttribute('data-unit', 'quarter'));
    expect(screen.getAllByTestId(/^cons-head-/).at(-1)).toHaveTextContent('Q4 2026');
  });

  it('inicio fiscal ≠ enero: se rotula con el rango de meses, no con «T»/«S»', () => {
    const t = (k: string, v?: Record<string, string | number>) => `${k}:${JSON.stringify(v)}`;
    expect(bucketLabel({ from: '2026-04-01', to: '2026-06-30', kind: 'quarter' }, 4, 'es', t)).toBe('abr 2026 – jun 2026');
    expect(bucketLabel({ from: '2026-04-01', to: '2026-06-30', kind: 'quarter' }, 1, 'es', t)).toContain('quarterLabel:{"n":2,"year":2026}');
    expect(bucketLabel({ from: '2026-07-01', to: '2026-11-23', kind: 'semester' }, 1, 'en', t)).toContain('semesterLabel:{"n":2,"year":2026}');
  });
});
