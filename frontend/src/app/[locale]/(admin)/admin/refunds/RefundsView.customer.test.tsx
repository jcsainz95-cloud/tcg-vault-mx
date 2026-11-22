import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { RefundsView } from './RefundsView';

vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/refunds',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => vi.restoreAllMocks());

describe('§FICHA-CLIENTE · /admin/refunds?userId=', () => {
  it('pasa userId a ambas cubetas y ofrece quitar el filtro', async () => {
    const spei = vi.spyOn(api, 'getManualRefunds');
    renderWithProviders(<RefundsView customerUserId="u-777" />, 'es');
    expect(await screen.findByTestId('refunds-customer-filter')).toBeInTheDocument();
    expect(screen.getByTestId('refunds-customer-filter-clear')).toHaveAttribute('href', '/admin/refunds');
    await waitFor(() => expect(spei).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-777' })));
  });

  it('sin userId no hay chip', async () => {
    renderWithProviders(<RefundsView />, 'es');
    await screen.findByRole('tablist');
    expect(screen.queryByTestId('refunds-customer-filter')).not.toBeInTheDocument();
  });
});
