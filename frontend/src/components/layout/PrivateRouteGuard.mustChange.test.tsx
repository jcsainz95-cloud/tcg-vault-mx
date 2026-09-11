import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { PrivateRouteGuard } from './PrivateRouteGuard';
import { setStoredUser } from '@/lib/session';
import type { UserDTO } from '@/types/contract';

// Modo REAL (los guards de sesión aplican). El bloqueo por temporal aplica en ambos modos.
vi.mock('@/lib/config', () => ({ config: { useMocks: false } }));

const replace = vi.fn();
let currentPath = '/';
let currentSearch = '';
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => currentPath,
}));
// El query string vive en `next/navigation` (next-intl solo da el pathname sin locale).
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

const customer: UserDTO = { id: 'u-1', email: 'c@example.com', name: 'C', role: 'customer', locale: 'es' };

function renderGuard() {
  return renderWithIntl(<PrivateRouteGuard>contenido</PrivateRouteGuard>, 'es');
}

/**
 * v1.67 — DESIGN_SYSTEM §33.8 paso 3 (candado CA-3 de §33.16 R10): con `mustChangePassword=true`
 * TODO el storefront (público o privado) acaba en `/account/password?next=<ruta>&reason=required`
 * y NUNCA pinta el contenido. `/account` gana su sitio en `PRIVATE_PREFIXES` (§4.47.7).
 */
describe('PrivateRouteGuard · contraseña temporal bloquea + /account privada', () => {
  beforeEach(() => {
    replace.mockClear();
    window.localStorage.clear();
    setStoredUser(null);
    currentPath = '/';
    currentSearch = '';
  });

  it.each(['/catalog', '/vault', '/orders', '/account'])(
    'CA-3: con la bandera activa, %s rebota a /account/password con next y reason y no pinta contenido',
    async (path) => {
      currentPath = path;
      setStoredUser({ ...customer, mustChangePassword: true });
      renderGuard();
      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith(`/account/password?next=${encodeURIComponent(path)}&reason=required`),
      );
      expect(screen.queryByText('contenido')).not.toBeInTheDocument();
    },
  );

  it('CA-3: en la raíz rebota con reason y SIN next (no hay a dónde volver que no sea el home)', async () => {
    currentPath = '/';
    setStoredUser({ ...customer, mustChangePassword: true });
    renderGuard();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/account/password?reason=required'));
    expect(screen.queryByText('contenido')).not.toBeInTheDocument();
  });

  it('F2-3: el rebote desde /vault?tab=retiros CONSERVA ?tab=retiros dentro de next (vía buildPasswordChangeRedirect)', async () => {
    currentPath = '/vault';
    currentSearch = 'tab=retiros';
    setStoredUser({ ...customer, mustChangePassword: true });
    renderGuard();
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/account/password?next=%2Fvault%3Ftab%3Dretiros&reason=required'),
    );
    expect(screen.queryByText('contenido')).not.toBeInTheDocument();
  });

  it('en /account/password con la bandera activa NO rebota y pinta la página (única pantalla operable)', async () => {
    currentPath = '/account/password';
    setStoredUser({ ...customer, mustChangePassword: true });
    renderGuard();
    expect(await screen.findByText('contenido')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('sin la bandera, una ruta pública pinta el contenido y no rebota', async () => {
    currentPath = '/catalog';
    setStoredUser({ ...customer, mustChangePassword: false });
    renderGuard();
    expect(await screen.findByText('contenido')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('CA-2: /account sin sesión → /login?next=/account', async () => {
    currentPath = '/account';
    renderGuard();
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({ pathname: '/login', query: { next: '/account' } }),
    );
    expect(screen.queryByText('contenido')).not.toBeInTheDocument();
  });

  it('/account/password sin sesión → /login?next=/account/password', async () => {
    currentPath = '/account/password';
    renderGuard();
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({ pathname: '/login', query: { next: '/account/password' } }),
    );
  });
});
