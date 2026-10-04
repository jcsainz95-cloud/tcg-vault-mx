import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { OperatorRefundsView } from './OperatorRefundsView';
import * as api from '@/lib/api';
import type { OperatorRefundSummaryDTO } from '@/types/contract';

/**
 * **UX-8 = STF-27 (front) en «Reembolsos de operadores»** (`API_CONTRACT §M6-U.8 (b)`, `DESIGN_SYSTEM §42.5.1`,
 * criterio 268): la fila de un operador SIN correo se identifica por su usuario. Canario: pintar
 * `user.email` a pelo ⇒ la fila queda con un hueco.
 */

vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/refunds',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

function op(user: OperatorRefundSummaryDTO['user']): OperatorRefundSummaryDTO {
  return {
    user,
    refunds: { last24h: { count: 0, cents: 0 }, last7d: { count: 0, cents: 0 }, last30d: { count: 0, cents: 0 } },
    capUsedCents: 0,
    prepared30d: { shipments: 0, lines: 0, missingLines: 0, missingRatePct: null },
    shrinkage30d: { pieces: 0, costCents: 0, unknownCostPieces: 0 },
    selfReplaced30d: 0,
  };
}

describe('UX-8 · «Reembolsos de operadores» con un operador sin correo', () => {
  it('pinta `email ?? username`; el DOM no contiene `null` ni `undefined`', async () => {
    vi.spyOn(api, 'getOperatorRefundSummary').mockResolvedValue({
      generatedAt: '2026-10-04T12:00:00Z',
      capCents: 500000,
      operators: [
        op({ userId: 'u-ana', name: 'Ana Operadora', email: null, username: 'ana', active: true }),
        op({ userId: 'u-op1', name: 'Op Correo', email: 'op@tcghunt.mx', username: null, active: true }),
      ],
    });
    vi.spyOn(api, 'getAdminRefunds').mockResolvedValue({ data: [], page: 1, pageSize: 25, total: 0, sumCents: 0 });
    const { container } = renderWithProviders(<OperatorRefundsView />, 'es');
    expect((await screen.findAllByText('Ana Operadora')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('ana').length).toBeGreaterThan(0);
    expect(screen.getAllByText('op@tcghunt.mx').length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\bnull\b|\bundefined\b/);
  });
});
