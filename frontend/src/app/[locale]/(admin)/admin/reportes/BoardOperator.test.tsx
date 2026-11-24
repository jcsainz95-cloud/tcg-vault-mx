import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { periodFor } from '@/lib/reports/period';
import { BoardView } from './BoardView';
import * as api from '@/lib/api';

vi.mock('@/lib/role', () => ({ useRole: () => ({ role: 'vault_operator', setRole: () => {}, isSuperAdmin: false, canSwitchRole: false }) }));
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
afterEach(() => vi.restoreAllMocks());

/** F2b: la franja «A la fecha» es dinero ⇒ solo súper-admin; el operador ni la ve ni dispara sus 4 llamadas. */
describe('Junta · franja «A la fecha» para el operador', () => {
  it('no se pinta y no pide pnl/series', async () => {
    const cal = vi.spyOn(api, 'getPnlCalendar');
    renderWithProviders(<BoardView initialPeriod={periodFor('month', '2026-11-23')} />, 'es');
    await screen.findByTestId('board-period').catch(() => null);
    expect(screen.queryByTestId('franja-to-date')).toBeNull();
    expect(cal).not.toHaveBeenCalled();
  });
});
