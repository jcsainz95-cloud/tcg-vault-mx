import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { PrivateRouteGuard } from '@/components/layout/PrivateRouteGuard';
import { setStoredUser } from '@/lib/session';
import type { UserDTO } from '@/types/contract';

/**
 * ANCLA DEL CRITERIO 45 — `/checkout` es PÚBLICA (v1.21-guest-checkout).
 *
 * Por qué este test existe y por qué está en MODO REAL: `PrivateRouteGuard` es INERTE cuando
 * `config.useMocks` es true, así que toda la suite E2E (que corre en mock) daba verde aunque el
 * guard expulsara al invitado a `/login` contra el stack real. Este test fuerza `useMocks:false`
 * para que la regresión —volver a meter '/checkout' en `PRIVATE_PREFIXES`— falle aquí y no en
 * producción.
 *
 * No es una relajación de seguridad: el guard es una conveniencia de cliente, el backend sigue
 * siendo la autoridad (401) y los endpoints `/checkout/guest/*` son `@Public()` por contrato §4-G.
 */
vi.mock('@/lib/config', () => ({ config: { useMocks: false } }));

const replace = vi.fn();
let currentPath = '/checkout';
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
  return renderWithIntl(<PrivateRouteGuard>checkout-montado</PrivateRouteGuard>, 'es');
}

describe('checkout público · guest checkout (criterio 45, modo REAL)', () => {
  beforeEach(() => {
    replace.mockClear();
    setStoredUser(null);
    window.localStorage.clear();
    currentPath = '/checkout';
  });

  it('un visitante SIN sesión entra a /checkout: se monta la vista y NO hay redirección a /login', async () => {
    renderGuard();
    await waitFor(() => expect(screen.getByText('checkout-montado')).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
  });

  it('tampoco redirige en subrutas de /checkout', async () => {
    currentPath = '/checkout/confirmacion';
    renderGuard();
    await waitFor(() => expect(screen.getByText('checkout-montado')).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
  });

  it('con sesión el checkout sigue montándose igual (el flujo con cuenta no cambia)', async () => {
    setStoredUser(user);
    renderGuard();
    await waitFor(() => expect(screen.getByText('checkout-montado')).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
  });

  it('las rutas que SIGUEN siendo privadas no se aflojaron: /vault, /orders y /shipments redirigen', async () => {
    for (const path of ['/vault', '/orders', '/shipments']) {
      replace.mockClear();
      currentPath = path;
      const { unmount } = renderGuard();
      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith({ pathname: '/login', query: { next: path } }),
      );
      expect(screen.queryByText('checkout-montado')).not.toBeInTheDocument();
      unmount();
    }
  });
});
