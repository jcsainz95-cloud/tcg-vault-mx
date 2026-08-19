import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { AdminTopbar } from './AdminTopbar';

// Capturamos el ruteo de next-intl y el logout del API (no queremos pegarle a nada real).
const push = vi.fn();
const replace = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => '/admin',
}));

const logout = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/api', () => ({ logout: () => logout() }));

describe('AdminTopbar · logout (P-1)', () => {
  beforeEach(() => {
    push.mockClear();
    replace.mockClear();
    logout.mockClear();
  });

  it('el control de logout llama logout() y rutea directo a /login (sin flash del guard)', async () => {
    renderWithIntl(<AdminTopbar />, 'es');
    fireEvent.click(screen.getByRole('button', { name: /Cerrar sesión/i }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    // P-1: replace (no push) a /login → sin parpadeo "Verificando sesión…" ni ?next=.
    expect(replace).toHaveBeenCalledWith('/login');
    expect(push).not.toHaveBeenCalled();
  });
});
