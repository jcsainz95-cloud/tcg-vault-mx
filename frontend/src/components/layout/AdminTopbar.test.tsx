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
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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

/** v1.67 — DESIGN_SYSTEM §33.2: «Mi cuenta» en el topbar, antes de «Cerrar sesión», hacia /admin/account. */
describe('AdminTopbar · «Mi cuenta» (§33.2)', () => {
  it('pinta el enlace a /admin/account con la misma piel y ANTES de «Cerrar sesión» en el orden de tabulación', () => {
    renderWithIntl(<AdminTopbar />, 'es');
    const account = screen.getByRole('link', { name: 'Mi cuenta' });
    expect(account).toHaveAttribute('href', '/admin/account');
    const logout = screen.getByRole('button', { name: /Cerrar sesión/i });
    // eslint-disable-next-line no-bitwise
    expect(account.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Área táctil de 44px (P-66 I5) en los dos.
    expect(account.className).toContain('min-h-[44px]');
    expect(logout.className).toContain('min-h-[44px]');
  });
});
