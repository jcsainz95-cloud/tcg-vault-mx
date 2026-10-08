import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';

/** `DESIGN_SYSTEM §AC-UX.9`: «Accesorios» en el grupo «Existencias», justo tras «Sellado», sin marca SÚPER. */
const roleState = vi.hoisted(() => ({ role: 'vault_operator' }));
vi.mock('@/hooks/usePickingSummary', () => ({
  PICKING_SUMMARY_KEY: ['admin-picking-summary'],
  usePickingSummary: () => ({ data: undefined }),
}));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: roleState.role, setRole: () => {}, isSuperAdmin: roleState.role === 'super_admin', canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/accessories/acc-1',
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { AdminSidebar, ADMIN_MENU_ITEMS } from './AdminSidebar';

describe('§AC-UX.9 · entrada «Accesorios» del menú', () => {
  it('va justo después de «Sellado» y la ve el operador', () => {
    const hrefs = ADMIN_MENU_ITEMS.map((i) => i.href);
    expect(hrefs.indexOf('/admin/accessories')).toBe(hrefs.indexOf('/admin/m11') + 1);
    expect(ADMIN_MENU_ITEMS.find((i) => i.href === '/admin/accessories')?.superAdminOnly).toBeFalsy();
  });

  it('en una ficha del panel se ilumina «Accesorios»', () => {
    renderWithProviders(<AdminSidebar />, 'es');
    const link = screen.getAllByRole('link', { name: /Accesorios/ })[0];
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(within(link).queryByText(/SÚPER/i)).toBeNull();
  });
});
