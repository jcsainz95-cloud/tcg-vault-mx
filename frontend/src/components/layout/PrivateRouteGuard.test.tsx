import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { PrivateRouteGuard } from './PrivateRouteGuard';
import { setStoredUser } from '@/lib/session';
import type { UserDTO } from '@/types/contract';

// Modo REAL: el guard aplica (requireAuth = !config.useMocks).
vi.mock('@/lib/config', () => ({ config: { useMocks: false } }));

const replace = vi.fn();
let currentPath = '/vault';
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => currentPath,
}));

const user: UserDTO = {
  id: 'u-1',
  email: 'cliente@example.com',
  name: 'Cliente',
  role: 'customer',
  locale: 'es',
};

function renderGuard() {
  return renderWithIntl(<PrivateRouteGuard>contenido-privado</PrivateRouteGuard>, 'es');
}

describe('PrivateRouteGuard · rutas privadas del storefront (modo real)', () => {
  beforeEach(() => {
    replace.mockClear();
    setStoredUser(null);
    window.localStorage.clear();
    currentPath = '/vault';
  });

  it('ruta privada sin sesión → redirige a /login?next=<ruta> y NO pinta el contenido', async () => {
    currentPath = '/vault';
    renderGuard();
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({ pathname: '/login', query: { next: '/vault' } }),
    );
    expect(screen.queryByText('contenido-privado')).not.toBeInTheDocument();
  });

  it('preserva el destino en `next` para cada prefijo privado (/checkout)', async () => {
    currentPath = '/checkout';
    renderGuard();
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({ pathname: '/login', query: { next: '/checkout' } }),
    );
  });

  it('ruta PÚBLICA sin sesión → NO redirige y pinta el contenido', async () => {
    currentPath = '/catalog';
    renderGuard();
    await waitFor(() => expect(screen.getByText('contenido-privado')).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
  });

  it('ruta privada CON sesión → pinta el contenido y no redirige', async () => {
    setStoredUser(user);
    currentPath = '/orders';
    renderGuard();
    await waitFor(() => expect(screen.getByText('contenido-privado')).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
  });
});
