import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { StorefrontHeader } from './StorefrontHeader';
import { setStoredUser } from '@/lib/session';
import { setToken } from '@/lib/api-client';
import type { UserDTO } from '@/types/contract';

// El header usa next-intl navigation (usePathname/useRouter/Link), que requiere el
// router de Next. Lo mockeamos para aislar la lógica de sesión del header.
// Mutable para poder simular la ruta activa (P-28: el carrito de compra se oculta en /buylist).
let mockPathname = '/';
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => mockPathname,
  // El header ya no navega (sin logout), pero `LocaleToggle` sí usa el router.
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
    setToken(null);
    setStoredUser(null);
    window.localStorage.clear();
    mockPathname = '/';
  });

  it('sin sesión muestra "Mi cuenta" (→ /login) y NO el logout', () => {
    renderWithIntl(<StorefrontHeader />, 'es');
    expect(screen.getByRole('link', { name: 'Mi cuenta' })).toHaveAttribute('href', '/login');
    expect(screen.queryByText('Cerrar sesión')).not.toBeInTheDocument();
  });

  /**
   * v1.67 — DESIGN_SYSTEM §33.1 (candado CA-1 de §33.16 R10): con sesión el header pinta
   * EXACTAMENTE cinco entradas y NINGUNA es el nombre; «Cerrar sesión» sale del header (vive en
   * «Mi cuenta», regla 8) y «Mi cuenta» ocupa el mismo hueco con el mismo rótulo (→ /account).
   */
  it('CA-1: con sesión el nav tiene exactamente cinco entradas, sin nombre ni «Cerrar sesión»', async () => {
    setStoredUser(user);
    renderWithIntl(<StorefrontHeader />, 'es');

    const account = await screen.findByRole('link', { name: 'Mi cuenta' });
    expect(account).toHaveAttribute('href', '/account');
    const nav = account.closest('nav') as HTMLElement;
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent?.trim());
    expect(labels).toEqual(['Comprar', 'Vender', 'Mi bóveda', 'Compras y ventas', 'Mi cuenta']);
    expect(screen.queryByText('Ash Ketchum')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cerrar sesión/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Cerrar sesión')).not.toBeInTheDocument();
  });

  it('nunca pinta el nombre ni el correo del usuario (regla 2: el nombre no es rótulo)', async () => {
    setStoredUser({ ...user, name: '' });
    renderWithIntl(<StorefrontHeader />, 'es');
    await screen.findByRole('link', { name: 'Mi cuenta' });
    expect(screen.queryByText('ash@example.com')).not.toBeInTheDocument();
  });

  it('«Envíos» sale del menú y «Compras y ventas» apunta a /orders', async () => {
    setStoredUser(user);
    renderWithIntl(<StorefrontHeader />, 'es');
    expect(await screen.findByRole('link', { name: 'Compras y ventas' })).toHaveAttribute('href', '/orders');
    expect(screen.queryByRole('link', { name: 'Mis retiros' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mis órdenes' })).not.toBeInTheDocument();
  });

  it('«Mi bóveda» se activa también en /shipments (§33.1: el retiro es una acción sobre la bóveda)', async () => {
    mockPathname = '/shipments';
    setStoredUser(user);
    renderWithIntl(<StorefrontHeader />, 'es');
    expect(await screen.findByRole('link', { name: 'Mi bóveda' })).toHaveAttribute('aria-current', 'page');
  });

  it('en /buylist/requests/:id se activa «Compras y ventas», no «Vender»', async () => {
    mockPathname = '/buylist/requests/sr-1';
    setStoredUser(user);
    renderWithIntl(<StorefrontHeader />, 'es');
    expect(await screen.findByRole('link', { name: 'Compras y ventas' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Vender' })).not.toHaveAttribute('aria-current');
  });

  it('el drawer móvil lleva las mismas cinco entradas y ningún «Cerrar sesión»', async () => {
    setStoredUser(user);
    renderWithIntl(<StorefrontHeader />, 'es');
    await screen.findByRole('link', { name: 'Mi cuenta' });
    fireEvent.click(screen.getByRole('button', { name: 'Menú' }));
    expect(screen.getAllByRole('link', { name: 'Mi cuenta' })).toHaveLength(2);
    expect(screen.queryByText('Cerrar sesión')).not.toBeInTheDocument();
    expect(screen.queryByText('Ash Ketchum')).not.toBeInTheDocument();
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

  it('sin sesión el nav público muestra Comprar, Vender y Mi cuenta (oculta bóveda y órdenes)', () => {
    renderWithIntl(<StorefrontHeader />, 'es');
    // "Comprar" agrupa Cartas sueltas + Producto sellado; apunta a /catalog por default.
    expect(screen.getByRole('link', { name: 'Comprar' })).toHaveAttribute('href', '/catalog');
    expect(screen.getByRole('link', { name: 'Vender' })).toHaveAttribute('href', '/buylist');
    expect(screen.getByRole('link', { name: 'Mi cuenta' })).toHaveAttribute('href', '/login');
    // Áreas privadas: no visibles para el público (P-13).
    expect(screen.queryByRole('link', { name: 'Mi bóveda' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mis órdenes' })).not.toBeInTheDocument();
  });

  it('con sesión el nav agrega "Mi bóveda" (/vault) y "Compras y ventas" (/orders)', async () => {
    setStoredUser(user);
    renderWithIntl(<StorefrontHeader />, 'es');
    const vault = await screen.findByRole('link', { name: 'Mi bóveda' });
    expect(vault).toHaveAttribute('href', '/vault');
    expect(screen.getByRole('link', { name: 'Compras y ventas' })).toHaveAttribute('href', '/orders');
  });

  it('P-28: fuera del flujo de venta muestra el carrito de compra en el header', () => {
    mockPathname = '/catalog';
    renderWithIntl(<StorefrontHeader />, 'es');
    const cart = screen.getByRole('link', { name: /Carrito/ });
    expect(cart).toHaveAttribute('href', '/checkout');
  });

  it('P-28: en /buylist (Vender) OCULTA el carrito de compra del header (queda solo el FAB de venta)', () => {
    mockPathname = '/buylist';
    renderWithIntl(<StorefrontHeader />, 'es');
    // El único "carrito" en la página de Vender debe ser el FAB de venta (fuera del header),
    // así "CARRITO 1" (compra) ya no compite con el "5" del cotizador.
    expect(screen.queryByRole('link', { name: /Carrito/ })).toBeNull();
  });

  it('TL-C1: expone su altura real como `--app-header-h` en el contenedor del layout (y la limpia al desmontar)', () => {
    // jsdom no pinta layout (offsetHeight=0), así que se asserta el MECANISMO: la var CSS
    // queda definida en px sobre el padre inmediato del header (el wrapper del layout del
    // storefront) — es lo que consume el sticky del binder quoter vía
    // `lg:top-[var(--app-header-h,0px)]` para no quedar tapado por el header (z-40 opaco).
    const { container, unmount } = renderWithIntl(<StorefrontHeader />, 'es');
    expect(container.style.getPropertyValue('--app-header-h')).toMatch(/^\d+px$/);
    unmount();
    expect(container.style.getPropertyValue('--app-header-h')).toBe('');
  });
});
