import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { ToDateStrip } from './ToDateStrip';
import * as api from '@/lib/api';
import { mockPnlCalendar } from '@/lib/mock/pnl-lines';
import { formatMoneyCents } from '@/lib/format';
import es from '../../../../../../messages/es.json';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/reportes',
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

/** §3b — franja «A la fecha» de la Junta: 4 llamadas `count=1`, último cubo; cada celda es la del JSON, sin cálculo en pantalla. */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-24T18:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Junta · franja «A la fecha»', () => {
  it('pide mes, trimestre, semestre y año con count=1 y pinta las cifras del último cubo', async () => {
    const spy = vi.spyOn(api, 'getPnlCalendar').mockImplementation(async (p) => mockPnlCalendar({ ...p, asOf: '2026-11-24' }));
    renderWithProviders(<ToDateStrip href="/admin/m7" seeFull="Ver" />);
    for (const u of ['month', 'quarter', 'semester', 'year'] as const) {
      const col = await screen.findByTestId(`to-date-${u}`);
      const last = mockPnlCalendar({ unit: u, count: 1, asOf: '2026-11-24' }).buckets.at(-1)!;
      expect(col).toHaveAttribute('data-todate', 'true');
      expect(within(col).getByText(es.admin.reports.compare.toDate[u])).toBeInTheDocument();
      const vals = within(col).getAllByTestId('to-date-value').map((e) => e.textContent);
      expect(vals).toEqual([last.total.netSalesCents, last.total.grossProfitCents, last.total.contributionCents].map((c) => formatMoneyCents(c, 'es')));
      expect(within(col).getByText(es.admin.reports.board.areas.toDate.result)).toBeInTheDocument();
      expect(spy).toHaveBeenCalledWith({ unit: u, count: 1 });
    }
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('basis none ⇒ «—» en la variación; nunca un porcentaje sin base', async () => {
    vi.spyOn(api, 'getPnlCalendar').mockImplementation(async (p) => {
      const c = mockPnlCalendar({ ...p, asOf: '2026-11-24' });
      return { ...c, buckets: c.buckets.map((b) => ({ ...b, comparison: { ...b.comparison, basis: 'none' as const } })) };
    });
    renderWithProviders(<ToDateStrip href="/admin/m7" seeFull="Ver" />);
    const col = await screen.findByTestId('to-date-year');
    expect(within(col).queryAllByTestId('delta')).toHaveLength(0);
    expect(col.textContent).toContain('—');
  });
  it('I-3: cada fila lleva SU variación (ventas netas, ganancia bruta, resultado), no la de otra', async () => {
    vi.spyOn(api, 'getPnlCalendar').mockImplementation(async (p) => {
      const c = mockPnlCalendar({ ...p, asOf: '2026-11-24' });
      const mk = (bps: number) => ({ cents: 1, previousCents: 1, deltaCents: 1, deltaBps: bps });
      return { ...c, buckets: c.buckets.map((b) => ({ ...b, comparison: { ...b.comparison, basis: 'complete' as const, total: { ...b.comparison.total, netSalesCents: mk(1111), grossProfitCents: mk(2222), contributionCents: mk(3333) } } })) };
    });
    renderWithProviders(<ToDateStrip href="/admin/m7" seeFull="Ver" />);
    const col = await screen.findByTestId('to-date-month');
    const d = within(col).getAllByTestId('delta').map((e) => e.textContent);
    expect(d).toHaveLength(3);
    expect(d[0]).toContain('11.1 %');
    expect(d[1]).toContain('22.2 %');
    expect(d[2]).toContain('33.3 %');
  });

  it('m-2: previous.clamped ⇒ rotula el recorte con el texto del contrato; sin recorte, nada', async () => {
    vi.spyOn(api, 'getPnlCalendar').mockImplementation(async (p) => {
      const c = mockPnlCalendar({ ...p, asOf: '2026-11-24' });
      return { ...c, buckets: c.buckets.map((b) => ({ ...b, to: p.unit === 'month' ? '2026-11-30' : b.to, comparison: { ...b.comparison, previous: { ...b.comparison.previous, to: '2026-10-31', clamped: p.unit === 'month' } } })) };
    });
    renderWithProviders(<ToDateStrip href="/admin/m7" seeFull="Ver" />);
    const col = await screen.findByTestId('to-date-month');
    expect(within(col).getByTestId('to-date-clamped')).toHaveTextContent('El mes de comparación no tiene día 30: se comparó hasta su último día (31 oct).');
    expect(within(await screen.findByTestId('to-date-year')).queryByTestId('to-date-clamped')).toBeNull();
  });
});
