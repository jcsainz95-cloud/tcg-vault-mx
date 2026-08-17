import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { StorefrontHeader } from './StorefrontHeader';
import { setStoredUser } from '@/lib/session';
import { setToken } from '@/lib/api-client';
import type { UserDTO } from '@/types/contract';

// El header usa next-intl navigation (usePathname/useRouter/Link), que requiere el
// router de Next. Lo mockeamos para aislar la lógica de sesión del header.
const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const user: UserDTO = {
  id: 'u-1',
  email: 'ash@example.com',
  name: 'Ash Ketchum',
  role: 'customer',
  locale: 'es',
};

describe('StorefrontHeader — sesión', () => {
  beforeEach(() => {
    push.mockClear();
    setToken(null);
    setStoredUser(null);
    window.localStorage.clear();
  });

  it('sin sesión muestra "Iniciar sesión" y NO el logout', () => {
    renderWithIntl(<StorefrontHeader />, 'es');
    expect(screen.getAllByText('Iniciar sesión').length).toBeGreaterThan(0);
    expect(screen.queryByText('Cerrar sesión')).not.toBeInTheDocument();
  });

  it('con sesión muestra el perfil (nombre) y "Cerrar sesión" en vez de "Iniciar sesión"', async () => {
    setStoredUser(user);
    renderWithIntl(<StorefrontHeader />, 'es');

    await waitFor(() => expect(screen.getByText('Ash Ketchum')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Cerrar sesión/ })).toBeInTheDocument();
    expect(screen.queryByText('Iniciar sesión')).not.toBeInTheDocument();
  });

  it('cae al email cuando el usuario no tiene nombre', async () => {
    setStoredUser({ ...user, name: '' });
    renderWithIntl(<StorefrontHeader />, 'es');
    await waitFor(() => expect(screen.getByText('ash@example.com')).toBeInTheDocument());
  });

  it('al cerrar sesión limpia el estado y vuelve a "Iniciar sesión" (reactivo, sin recargar)', async () => {
    setStoredUser(user);
    renderWithIntl(<StorefrontHeader />, 'es');

    const logoutBtn = await screen.findByRole('button', { name: /Cerrar sesión/ });
    fireEvent.click(logoutBtn);

    await waitFor(() => expect(screen.getAllByText('Iniciar sesión').length).toBeGreaterThan(0));
    expect(screen.queryByText('Ash Ketchum')).not.toBeInTheDocument();
    expect(push).toHaveBeenCalledWith('/');
  });

  it('en inglés el nav de venta se etiqueta "Sell" (ruta interna /buylist)', () => {
    renderWithIntl(<StorefrontHeader />, 'en');
    const sell = screen.getByRole('link', { name: 'Sell' });
    expect(sell).toHaveAttribute('href', '/buylist');
  });

  it('en español el nav de venta se etiqueta "Vender"', () => {
    renderWithIntl(<StorefrontHeader />, 'es');
    const vender = screen.getByRole('link', { name: 'Vender' });
    expect(vender).toHaveAttribute('href', '/buylist');
  });

  it('sin sesión el nav público solo muestra Compra y Vender (oculta bóveda y órdenes)', () => {
    renderWithIntl(<StorefrontHeader />, 'es');
    expect(screen.getByRole('link', { name: 'Compra' })).toHaveAttribute('href', '/catalog');
    expect(screen.getByRole('link', { name: 'Vender' })).toHaveAttribute('href', '/buylist');
    // Áreas privadas: no visibles para el público (P-13).
    expect(screen.queryByRole('link', { name: 'Mi bóveda' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mis órdenes' })).not.toBeInTheDocument();
  });

  it('con sesión el nav agrega "Mi bóveda" (/vault) y "Mis órdenes" (/orders)', async () => {
    setStoredUser(user);
    renderWithIntl(<StorefrontHeader />, 'es');
    const vault = await screen.findByRole('link', { name: 'Mi bóveda' });
    expect(vault).toHaveAttribute('href', '/vault');
    expect(screen.getByRole('link', { name: 'Mis órdenes' })).toHaveAttribute('href', '/orders');
  });
});
