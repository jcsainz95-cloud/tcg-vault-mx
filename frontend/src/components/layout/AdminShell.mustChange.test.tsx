import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { AdminShell } from './AdminShell';
import { setStoredUser } from '@/lib/session';
import type { UserDTO } from '@/types/contract';

vi.mock('@/lib/config', () => ({ config: { useMocks: false, apiBaseUrl: '', googleClientId: '' } }));

const replace = vi.fn();
const push = vi.fn();
let currentPath = '/admin';
let currentSearch = '';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => currentPath,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const logout = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/api', () => ({ logout: () => logout() }));

const operator: UserDTO = { id: 'u-op', email: 'op@tcghunt.mx', name: 'Op', role: 'vault_operator', locale: 'es' };

/** v1.67 — DESIGN_SYSTEM §33.8 paso 3 (CA-3) sobre el panel, y §33.2 (pie del drawer). */
describe('AdminShell · contraseña temporal bloquea el panel', () => {
  beforeEach(() => {
    replace.mockClear();
    push.mockClear();
    logout.mockClear();
    window.localStorage.clear();
    setStoredUser(null);
    currentPath = '/admin';
    currentSearch = '';
  });

  it.each(['/admin', '/admin/m4'])(
    'CA-3: operador con la bandera en %s → /admin/account/password?next&reason, sin pintar el panel',
    async (path) => {
      currentPath = path;
      setStoredUser({ ...operator, mustChangePassword: true });
      renderWithIntl(<AdminShell>panel</AdminShell>, 'es');
      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith(
          `/admin/account/password?next=${encodeURIComponent(path)}&reason=required`,
        ),
      );
      expect(screen.queryByText('panel')).not.toBeInTheDocument();
    },
  );

  it('F2-3: el rebote desde /admin/m4?status=guia CONSERVA el query string en next y va a la página del ROL', async () => {
    currentPath = '/admin/m4';
    currentSearch = 'status=guia';
    setStoredUser({ ...operator, mustChangePassword: true });
    renderWithIntl(<AdminShell>panel</AdminShell>, 'es');
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        '/admin/account/password?next=%2Fadmin%2Fm4%3Fstatus%3Dguia&reason=required',
      ),
    );
    expect(screen.queryByText('panel')).not.toBeInTheDocument();
  });

  it('en /admin/account/password con la bandera activa pinta la página dentro del shell', async () => {
    currentPath = '/admin/account/password';
    setStoredUser({ ...operator, mustChangePassword: true });
    renderWithIntl(<AdminShell>panel</AdminShell>, 'es');
    expect(await screen.findByText('panel')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('sin la bandera el operador ve el panel; el drawer lleva «Mi cuenta» y «Cerrar sesión» al pie (§33.2)', async () => {
    setStoredUser({ ...operator, mustChangePassword: false });
    renderWithIntl(<AdminShell>panel</AdminShell>, 'es');
    expect(await screen.findByText('panel')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Menú' }));
    const links = screen.getAllByRole('link', { name: 'Mi cuenta' });
    expect(links.some((l) => l.getAttribute('href') === '/admin/account')).toBe(true);
    // «Mi cuenta» NO es un módulo del sidebar (§33.15.6): no lleva código M-n ni vive en la lista de módulos.
    const sidebarNav = screen.getAllByRole('navigation')[0];
    expect(sidebarNav.querySelector('a[href="/admin/account"]')).toBeNull();
    const logoutButtons = screen.getAllByRole('button', { name: 'Cerrar sesión' });
    fireEvent.click(logoutButtons[logoutButtons.length - 1]);
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith('/login');
  });
});
