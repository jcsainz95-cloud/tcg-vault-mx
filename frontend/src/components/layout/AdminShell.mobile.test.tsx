import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { setStoredUser } from '@/lib/session';
import { AdminShell } from './AdminShell';

/**
 * MOB-5 (vitest; DESIGN_SYSTEM §60.9 f): en todo el panel SALVO `/admin/m4` se pinta el aviso «pensada para
 * computadora», con enlace a M4 y oculto en `≥ lg` por CSS (`lg:hidden`, ⛔ sin JS de dispositivo). Canario:
 * pintarlo también en M4. La parte de ANCHO real la mide Playwright (`m4-mobile.spec.ts`).
 */
vi.mock('@/lib/config', () => ({ config: { useMocks: false, apiBaseUrl: '', googleClientId: '' } }));
const path = vi.hoisted(() => ({ value: '/admin/m3' }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => path.value,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  window.localStorage.clear();
  setStoredUser({ id: 'u-admin', email: 'a@x', name: 'Admin', role: 'super_admin', locale: 'es' });
});

describe('MOB-5 · aviso «pensada para computadora»', () => {
  it('/admin/m3 ⇒ el aviso, solo bajo `lg`, con el atajo a /admin/m4', async () => {
    path.value = '/admin/m3';
    renderWithProviders(<AdminShell>contenido</AdminShell>, 'es');
    const notice = await screen.findByTestId('admin-desktop-only');
    expect(notice).toHaveClass('lg:hidden');
    expect(notice).toHaveTextContent('Esta sección está pensada para computadora. En el celular, usa «Pedidos por preparar».');
    expect(notice.querySelector('a')).toHaveAttribute('href', '/admin/m4');
  });

  it('/admin/m4 ⇒ sin aviso', async () => {
    path.value = '/admin/m4';
    renderWithProviders(<AdminShell>contenido</AdminShell>, 'es');
    await waitFor(() => expect(screen.getByText('contenido')).toBeInTheDocument());
    expect(screen.queryByTestId('admin-desktop-only')).not.toBeInTheDocument();
  });
});
