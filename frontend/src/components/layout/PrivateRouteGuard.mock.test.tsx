import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { PrivateRouteGuard } from './PrivateRouteGuard';
import { setStoredUser } from '@/lib/session';

// Modo MOCK/DEMO: el guard es INERTE (espeja AdminShell: requireAuth = !config.useMocks).
vi.mock('@/lib/config', () => ({ config: { useMocks: true } }));

const replace = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/vault',
}));

describe('PrivateRouteGuard · inerte en modo mock/demo', () => {
  beforeEach(() => {
    replace.mockClear();
    setStoredUser(null);
    window.localStorage.clear();
  });

  it('ruta privada sin sesión en mock → NO redirige y pinta el contenido (demo sin backend)', async () => {
    renderWithIntl(<PrivateRouteGuard>contenido-privado</PrivateRouteGuard>, 'es');
    await waitFor(() => expect(screen.getByText('contenido-privado')).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
  });
});
