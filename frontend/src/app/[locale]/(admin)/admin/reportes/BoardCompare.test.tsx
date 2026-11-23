import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { periodFor } from '@/lib/reports/period';
import { BoardView } from './BoardView';
import * as api from '@/lib/api';
import { mockPnl } from '@/lib/mock/fixtures';
import { mockSalesReport } from '@/lib/mock/sales';
import { mockStatementOf } from '@/lib/mock/period-compare';
import type { ComparisonBasis, PnlDTO, SalesReportDTO } from '@/types/contract';

vi.mock('@/lib/role', () => ({ useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }) }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/reportes',
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/usePickingSummary', () => ({
  usePickingSummary: () => ({ isLoading: false, isError: false, refetch: () => {}, data: { ship: 0, vault: 0, toReplace: 0, toReplaceOverdue: 0, stuckRefunds: 0, oldestRequestedAt: null, oldestOpenCaseAt: null, manualRefundsPending: null } }),
}));

/** §REPORTES-CEO F2a — Junta: «Este mes» se compara con el MISMO tramo del mes anterior y siempre dice contra qué. */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T18:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const month = periodFor('month', '2026-11-23');

function sales(basis: ComparisonBasis, dataSince: string | null = null, clamped = false): SalesReportDTO {
  const r = mockSalesReport({ preset: 'custom', from: month.from, to: month.to, kind: 'month' }, new Date('2026-11-23T18:00:00Z'));
  return { ...r, previousPeriod: { ...r.previousPeriod, clamped }, comparison: { ...r.comparison, basis, dataSince } };
}
function pnl(basis: ComparisonBasis): PnlDTO {
  return {
    ...mockPnl,
    statement: mockStatementOf(mockPnl),
    comparison: {
      basis,
      dataSince: null,
      figures: {
        salesCents: { cents: 1, previousCents: 1, deltaCents: 0, deltaBps: 0 },
        returnsAndRefundsCents: { cents: 1, previousCents: 1, deltaCents: 0, deltaBps: 0 },
        netRevenueCents: { cents: 1, previousCents: 1, deltaCents: 0, deltaBps: 0 },
        cogsCents: { cents: 1, previousCents: 1, deltaCents: 0, deltaBps: 0 },
        stripeFeesCents: { cents: 1, previousCents: 1, deltaCents: 0, deltaBps: 0 },
        shippingCostCents: { cents: 1, previousCents: 1, deltaCents: 0, deltaBps: 0 },
        grossMarginCents: { cents: 1, previousCents: 1, deltaCents: 0, deltaBps: 0 },
        netResultCents: { cents: mockPnl.profitCents, previousCents: 400_000, deltaCents: 7, deltaBps: 1_234 },
      },
    },
  };
}

describe('§2 F2a · Junta de dirección con comparación de mismo tramo', () => {
  it('manda `kind: month` a Ventas y a Finanzas', async () => {
    const s = vi.spyOn(api, 'getSalesReport').mockResolvedValue(sales('complete'));
    const p = vi.spyOn(api, 'getPnl').mockResolvedValue(pnl('complete'));
    renderWithProviders(<BoardView initialPeriod={month} />, 'es');
    await screen.findByTestId('board-period');
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ kind: 'month', from: '2026-11-01', to: '2026-11-23' }));
    expect(p).toHaveBeenCalledWith(expect.objectContaining({ kind: 'month', from: '2026-11-01', to: '2026-11-23' }));
  });

  it('completo: «Mes a la fecha · 1–23 nov comparado con 1–23 oct» y las variaciones dicen «vs periodo anterior»', async () => {
    vi.spyOn(api, 'getSalesReport').mockResolvedValue(sales('complete'));
    vi.spyOn(api, 'getPnl').mockResolvedValue(pnl('complete'));
    renderWithProviders(<BoardView initialPeriod={month} />, 'es');
    const note = await screen.findByTestId('board-period');
    expect(note).toHaveTextContent('Mes a la fecha · 1–23 nov comparado con 1–23 oct');
    const fin = await screen.findByTestId('franja-finance');
    // resultado del periodo: 1 234 pb del servidor ⇒ «12.3 %»; nunca un % sin su base («vs periodo anterior»).
    expect(await within(fin).findByTestId('delta')).toHaveTextContent(/12\.3 %\s*vs periodo anterior/);
    expect(within(screen.getByTestId('franja-sales')).getAllByTestId('delta')[0]).toHaveTextContent('vs periodo anterior');
  });

  it('contra lo que hay: el rótulo dice desde cuándo hay datos y cada % dice «vs lo que hay»', async () => {
    vi.spyOn(api, 'getSalesReport').mockResolvedValue(sales('partial', '2026-10-12'));
    vi.spyOn(api, 'getPnl').mockResolvedValue({ ...pnl('partial') });
    renderWithProviders(<BoardView initialPeriod={month} />, 'es');
    expect(await screen.findByTestId('board-period')).toHaveTextContent('contra lo que hay (datos desde 12 oct 2026)');
    const fin = await screen.findByTestId('franja-finance');
    expect(await within(fin).findByTestId('delta')).toHaveTextContent('vs lo que hay');
    expect(within(fin).getByTestId('delta')).not.toHaveTextContent('vs periodo anterior');
  });

  it('sin comparación: «—» y «sin periodo anterior para comparar»; ningún % aunque el JSON traiga números', async () => {
    vi.spyOn(api, 'getSalesReport').mockResolvedValue(sales('none'));
    vi.spyOn(api, 'getPnl').mockResolvedValue(pnl('none'));
    renderWithProviders(<BoardView initialPeriod={month} />, 'es');
    const note = await screen.findByTestId('board-period');
    expect(note).toHaveAttribute('data-basis', 'none');
    expect(note).toHaveTextContent('Sin periodo anterior para comparar');
    await screen.findByTestId('franja-finance');
    await within(screen.getByTestId('franja-finance')).findByText('Ganancia');
    expect(screen.queryAllByTestId('delta')).toHaveLength(0);
  });

  it('periodo anterior más corto: avisa que se usó completo', async () => {
    vi.spyOn(api, 'getSalesReport').mockResolvedValue(sales('complete', null, true));
    vi.spyOn(api, 'getPnl').mockResolvedValue(pnl('complete'));
    renderWithProviders(<BoardView initialPeriod={month} />, 'es');
    expect(await screen.findByTestId('board-period-clamped')).toHaveTextContent('El periodo anterior es más corto y se usó completo.');
  });
});
