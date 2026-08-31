import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { AdminShell } from './AdminShell';
import { useRole } from '@/lib/role';
import { setStoredUser } from '@/lib/session';
import type { UserDTO } from '@/types/contract';

// Modo REAL: el back-office exige sesión (requireAuth = !config.useMocks).
vi.mock('@/lib/config', () => ({ config: { useMocks: false, apiBaseUrl: '', googleClientId: '' } }));

// next-intl navigation: capturamos replace/push y damos Link/usePathname.
const replace = vi.fn();
const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => '/admin',
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Sonda que revela el rol efectivo y si el switcher está disponible.
function RoleProbe() {
  const { role, canSwitchRole } = useRole();
  return (
    <div>
      role:{role} switch:{String(canSwitchRole)}
    </div>
  );
}

const admin: UserDTO = {
  id: 'u-admin',
  email: 'admin@ejemplo.test',
  name: 'Súper Admin',
  role: 'super_admin',
  locale: 'es',
};

describe('AdminShell — gate de sesión (modo real)', () => {
  beforeEach(() => {
    replace.mockClear();
    push.mockClear();
    setStoredUser(null);
    window.localStorage.clear();
  });

  it('sin sesión NO renderiza el back-office y redirige a /login con next', async () => {
    renderWithIntl(
      <AdminShell>
        <RoleProbe />
      </AdminShell>,
      'es',
    );

    // No se pinta el contenido del back-office (sin super_admin falso).
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({ pathname: '/login', query: { next: '/admin' } }),
    );
    expect(screen.queryByText(/role:/)).not.toBeInTheDocument();
    expect(screen.getByText('Verificando sesión…')).toBeInTheDocument();
  });

  it('con sesión renderiza el back-office y el rol viene de la SESIÓN (super_admin)', async () => {
    setStoredUser(admin);
    renderWithIntl(
      <AdminShell>
        <RoleProbe />
      </AdminShell>,
      'es',
    );

    await waitFor(() => expect(screen.getByText(/role:super_admin/)).toBeInTheDocument());
    // En modo real el switcher está deshabilitado (backend = autoridad).
    expect(screen.getByText(/switch:false/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('el rol efectivo es el del usuario de sesión (vault_operator), no super_admin', async () => {
    setStoredUser({ ...admin, role: 'vault_operator' });
    renderWithIntl(
      <AdminShell>
        <RoleProbe />
      </AdminShell>,
      'es',
    );

    await waitFor(() => expect(screen.getByText(/role:vault_operator/)).toBeInTheDocument());
  });

  it('un customer logueado NO ve el back-office y es redirigido al storefront', async () => {
    setStoredUser({ ...admin, role: 'customer' });
    renderWithIntl(
      <AdminShell>
        <RoleProbe />
      </AdminShell>,
      'es',
    );

    // Rol de cliente → replace('/') (no /login: ya hay sesión, solo falta el rol).
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    // Nunca se pinta el chrome del back-office.
    expect(screen.queryByText(/role:/)).not.toBeInTheDocument();
    expect(screen.getByText('Verificando sesión…')).toBeInTheDocument();
  });
});
