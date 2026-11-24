import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { expectOneDecimalPercents } from '@/test/pct';
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
    expectOneDecimalPercents(screen.getByTestId('franja-finance').textContent ?? '');
    expectOneDecimalPercents(screen.getByTestId('franja-sales').textContent ?? '');
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
    expect(note).toHaveTextContent('Sin ventas en el periodo anterior (1–23 oct)');
    expect(note).not.toHaveTextContent('Sin periodo anterior para comparar');
    await screen.findByTestId('franja-finance');
    await within(screen.getByTestId('franja-finance')).findByText('Ganancia');
    expect(screen.queryAllByTestId('delta')).toHaveLength(0);
  });

  it('periodo anterior más corto: avisa que se usó completo', async () => {
    vi.spyOn(api, 'getSalesReport').mockResolvedValue(sales('complete', null, true));
    vi.spyOn(api, 'getPnl').mockResolvedValue(pnl('complete'));
    renderWithProviders(<BoardView initialPeriod={month} />, 'es');
    expect(await screen.findByTestId('board-period-clamped')).toHaveTextContent('El mes de comparación no tiene día 23: se comparó hasta su último día (23 oct).');
  });

  // I-2 (qa): «a la fecha» sale de `period.toDate` de la RESPUESTA de Ventas (m-7), no del atajo ni del `kind` solo.
  it('m-7: kind efectivo `span` o toDate:false ⇒ nunca «Mes a la fecha», aunque el atajo sea «Este mes»', async () => {
    const base = sales('complete');
    vi.spyOn(api, 'getSalesReport').mockResolvedValue({ ...base, period: { ...base.period, kind: 'span', toDate: true } });
    vi.spyOn(api, 'getPnl').mockResolvedValue(pnl('complete'));
    const first = renderWithProviders(<BoardView initialPeriod={month} />, 'es');
    expect(await screen.findByTestId('board-period')).not.toHaveTextContent('a la fecha');
    first.unmount();
    vi.spyOn(api, 'getSalesReport').mockResolvedValue({ ...base, period: { ...base.period, kind: 'month', toDate: false } });
    renderWithProviders(<BoardView initialPeriod={month} />, 'es');
    expect(await screen.findByTestId('board-period')).not.toHaveTextContent('a la fecha');
  });

  // M-7 respaldo: CUALQUIERA de las dos consultas de periodo con 400/422 `VALIDATION_ERROR` ⇒ «Este mes» con aviso `fallback`.
  it.each([
    ['422 del P&L (finanzas)', 'pnl', 422],
    ['400 de Ventas', 'sales', 400],
    ['422 de Ventas', 'sales', 422],
    ['400 del P&L', 'pnl', 400],
  ] as const)('%s ⇒ vuelve a «Este mes» con el aviso', async (_n, which, status) => {
    const { ApiClientError } = await import('@/lib/api-client');
    const bad = new ApiClientError(status, { code: 'VALIDATION_ERROR', message: 'periodo' });
    const s = vi.spyOn(api, 'getSalesReport').mockImplementation(async (p) => {
      if (which === 'sales' && p?.kind === 'quarter') throw bad;
      return sales('complete');
    });
    vi.spyOn(api, 'getPnl').mockImplementation(async (r) => {
      if (which === 'pnl' && r?.kind === 'quarter') throw bad;
      return pnl('complete');
    });
    renderWithProviders(<BoardView initialPeriod={periodFor('quarter', '2026-11-23')} />, 'es');
    expect(await screen.findByText('Ese periodo no es válido: se muestra Este mes.')).toBeInTheDocument();
    await screen.findByTestId('board-period');
    expect(s).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'month' }));
    expect(screen.getByRole('button', { name: 'Este mes' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('un error que NO es VALIDATION_ERROR (500, 403) no dispara el respaldo', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'getSalesReport').mockResolvedValue(sales('complete'));
    vi.spyOn(api, 'getPnl').mockImplementation(async (r) => {
      if (r?.kind === 'quarter') throw new ApiClientError(422, { code: 'OTHER', message: 'x' });
      return pnl('complete');
    });
    renderWithProviders(<BoardView initialPeriod={periodFor('quarter', '2026-11-23')} />, 'es');
    await screen.findByTestId('franja-sales');
    expect(screen.queryByText('Ese periodo no es válido: se muestra Este mes.')).toBeNull();
  });

  // I-1: avisos de la URL (los tres), con el mismo Banner.
  it.each([
    ['fallback', 'invalid', 'Ese periodo no es válido: se muestra Este mes.'],
    ['allUnavailable', 'allUnavailable', '«Todo» no está disponible aquí (máximo 366 días): se muestra Este mes.'],
    ['tooLong', 'tooLong', 'Ese periodo pasa de 366 días: se muestra Este mes.'],
  ] as const)('aviso de la URL %s', async (_k, notice, text) => {
    vi.spyOn(api, 'getSalesReport').mockResolvedValue(sales('complete'));
    vi.spyOn(api, 'getPnl').mockResolvedValue(pnl('complete'));
    renderWithProviders(<BoardView initialPeriod={month} initialNotice={notice} />, 'es');
    const b = await screen.findByText(text);
    expect(b.closest('[role="status"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hoy' }));
    await waitFor(() => expect(screen.queryByText(text)).toBeNull());
  });
});
