import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
// ⚠️ `renderWithProviders`, no `renderWithIntl`: desde §R el header monta la CAMPANA
// (`PendingsBell`), que consulta `GET /me/pendings` con TanStack Query. Sin `QueryClientProvider`
// el header entero deja de renderizar. En el árbol real el provider ya está por encima
// (`app/[locale]/layout.tsx` → `Providers`), así que esto alinea el test con la app, no la app con
// el test. Con la sesión mock el endpoint devuelve `{pendings: []}` ⇒ la campana no se pinta y
// ninguna de las aserciones de nav/carrito de abajo ve un elemento nuevo.
import { renderWithProviders } from '@/test/render';
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
    renderWithProviders(<StorefrontHeader />, 'es');
    expect(screen.getByRole('link', { name: 'Mi cuenta' })).toHaveAttribute('href', '/login');
    expect(screen.queryByText('Cerrar sesión')).not.toBeInTheDocument();
  });

  /**
   * v1.67 — DESIGN_SYSTEM §33.1 (candado CA-1 de §33.16 R10): con sesión el header pinta
   * EXACTAMENTE seis entradas (la 6ª, «Meta Battle Decks», entra por decisión del dueño) y NINGUNA
   * es el nombre; «Cerrar sesión» sale del header (vive en «Mi cuenta», regla 8) y «Mi cuenta»
   * ocupa el mismo hueco con el mismo rótulo (→ /account).
   */
  it('CA-1: con sesión el nav tiene exactamente seis entradas, sin nombre ni «Cerrar sesión»', async () => {
    setStoredUser(user);
    renderWithProviders(<StorefrontHeader />, 'es');

    const account = await screen.findByRole('link', { name: 'Mi cuenta' });
    expect(account).toHaveAttribute('href', '/account');
    const nav = account.closest('nav') as HTMLElement;
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent?.trim());
    expect(labels).toEqual(['Comprar', 'Vender', 'Meta Battle Decks', 'Mi bóveda', 'Compras y ventas', 'Mi cuenta']);
    expect(screen.getByRole('link', { name: 'Meta Battle Decks' })).toHaveAttribute('href', '/decks-meta');
    expect(screen.queryByText('Ash Ketchum')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cerrar sesión/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Cerrar sesión')).not.toBeInTheDocument();
  });

  it('nunca pinta el nombre ni el correo del usuario (regla 2: el nombre no es rótulo)', async () => {
    setStoredUser({ ...user, name: '' });
    renderWithProviders(<StorefrontHeader />, 'es');
    await screen.findByRole('link', { name: 'Mi cuenta' });
    expect(screen.queryByText('ash@example.com')).not.toBeInTheDocument();
  });

  it('«Envíos» sale del menú y «Compras y ventas» apunta a /orders', async () => {
    setStoredUser(user);
    renderWithProviders(<StorefrontHeader />, 'es');
    expect(await screen.findByRole('link', { name: 'Compras y ventas' })).toHaveAttribute('href', '/orders');
    expect(screen.queryByRole('link', { name: 'Mis retiros' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mis órdenes' })).not.toBeInTheDocument();
  });

  it('«Mi bóveda» se activa también en /shipments (§33.1: el retiro es una acción sobre la bóveda)', async () => {
    mockPathname = '/shipments';
    setStoredUser(user);
    renderWithProviders(<StorefrontHeader />, 'es');
    expect(await screen.findByRole('link', { name: 'Mi bóveda' })).toHaveAttribute('aria-current', 'page');
  });

  it('en /buylist/requests/:id se activa «Compras y ventas», no «Vender»', async () => {
    mockPathname = '/buylist/requests/sr-1';
    setStoredUser(user);
    renderWithProviders(<StorefrontHeader />, 'es');
    expect(await screen.findByRole('link', { name: 'Compras y ventas' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Vender' })).not.toHaveAttribute('aria-current');
  });

  it('el drawer móvil lleva las mismas seis entradas y ningún «Cerrar sesión»', async () => {
    setStoredUser(user);
    renderWithProviders(<StorefrontHeader />, 'es');
    await screen.findByRole('link', { name: 'Mi cuenta' });
    fireEvent.click(screen.getByRole('button', { name: 'Menú' }));
    expect(screen.getAllByRole('link', { name: 'Mi cuenta' })).toHaveLength(2);
    expect(screen.queryByText('Cerrar sesión')).not.toBeInTheDocument();
    expect(screen.queryByText('Ash Ketchum')).not.toBeInTheDocument();
  });

  it('en inglés el nav de venta se etiqueta "Sell" (ruta interna /buylist)', () => {
    renderWithProviders(<StorefrontHeader />, 'en');
    const sell = screen.getByRole('link', { name: 'Sell' });
    expect(sell).toHaveAttribute('href', '/buylist');
  });

  it('en español el nav de venta se etiqueta "Vender"', () => {
    renderWithProviders(<StorefrontHeader />, 'es');
    const vender = screen.getByRole('link', { name: 'Vender' });
    expect(vender).toHaveAttribute('href', '/buylist');
  });

  it('sin sesión el nav público muestra Comprar, Vender y Mi cuenta (oculta bóveda y órdenes)', () => {
    renderWithProviders(<StorefrontHeader />, 'es');
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
    renderWithProviders(<StorefrontHeader />, 'es');
    const vault = await screen.findByRole('link', { name: 'Mi bóveda' });
    expect(vault).toHaveAttribute('href', '/vault');
    expect(screen.getByRole('link', { name: 'Compras y ventas' })).toHaveAttribute('href', '/orders');
  });

  it('P-28: fuera del flujo de venta muestra el carrito de compra en el header', () => {
    mockPathname = '/catalog';
    renderWithProviders(<StorefrontHeader />, 'es');
    // Dos accesos: el de lg (texto «Carrito N») y el icono de < lg (QA mkt 2026-11-02). Ambos a /checkout.
    const carts = screen.getAllByRole('link', { name: /Carrito/ });
    expect(carts).toHaveLength(2);
    for (const cart of carts) expect(cart).toHaveAttribute('href', '/checkout');
  });

  /**
   * QA de marketing (2026-11-02, medido por el orquestador en producción a 390 px): en < lg la cabecera no tenía
   * acceso al carrito (solo «inicio» y «Menú»). Candado: un enlace a /checkout FUERA del drawer (visible sin abrir el
   * menú), con la clase que lo esconde solo en lg, objetivo ≥ 44 px (`h-11` + `min-w-11`) y `aria-label` con la
   * cantidad. jsdom no pinta: la geometría real la afirma `e2e/header-cart-mobile.spec.ts`.
   */
  it('< lg: acceso al carrito siempre visible en la cabecera, con la cantidad en el nombre accesible', () => {
    window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1', 'inv-2'], updatedAt: Date.now() }));
    mockPathname = '/catalog';
    renderWithProviders(<StorefrontHeader />, 'es');
    const cart = screen.getByRole('link', { name: 'Carrito: 2 artículos' });
    expect(cart).toHaveAttribute('href', '/checkout');
    expect(cart).toHaveAttribute('data-testid', 'header-cart-mobile');
    // Sin abrir el menú: no vive en ningún <nav> (el drawer) y el menú está cerrado.
    expect(screen.getByRole('button', { name: 'Menú' })).toHaveAttribute('aria-expanded', 'false');
    expect(cart.closest('nav')).toBeNull();
    // Visible en < lg y oculto en lg (allí está el botón de texto); objetivo táctil ≥ 44 px.
    expect(cart.className).toMatch(/(^|\s)inline-flex(\s|$)/);
    expect(cart.className).toMatch(/(^|\s)lg:hidden(\s|$)/);
    expect(cart.className).toMatch(/(^|\s)h-11(\s|$)/);
    expect(cart.className).toMatch(/(^|\s)min-w-11(\s|$)/);
    expect(cart).toHaveTextContent('2');
  });

  it('< lg: con el carrito vacío el nombre accesible lo dice («Carrito: vacío» / «Cart: empty»)', () => {
    mockPathname = '/catalog';
    const { unmount } = renderWithProviders(<StorefrontHeader />, 'es');
    expect(screen.getByRole('link', { name: 'Carrito: vacío' })).toHaveAttribute('href', '/checkout');
    unmount();
    window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1'], updatedAt: Date.now() }));
    renderWithProviders(<StorefrontHeader />, 'en');
    expect(screen.getByRole('link', { name: 'Cart: 1 item' })).toHaveAttribute('href', '/checkout');
  });

  it('P-28: en /buylist (Vender) OCULTA el carrito de compra del header (queda solo el FAB de venta)', () => {
    mockPathname = '/buylist';
    renderWithProviders(<StorefrontHeader />, 'es');
    // El único "carrito" en la página de Vender debe ser el FAB de venta (fuera del header),
    // así "CARRITO 1" (compra) ya no compite con el "5" del cotizador.
    expect(screen.queryByRole('link', { name: /Carrito/ })).toBeNull();
  });

  it('TL-C1: expone su altura real como `--app-header-h` en el contenedor del layout (y la limpia al desmontar)', () => {
    // jsdom no pinta layout (offsetHeight=0), así que se asserta el MECANISMO: la var CSS
    // queda definida en px sobre el padre inmediato del header (el wrapper del layout del
    // storefront) — es lo que consume el sticky del binder quoter vía
    // `lg:top-[var(--app-header-h,0px)]` para no quedar tapado por el header (z-40 opaco).
    const { container, unmount } = renderWithProviders(<StorefrontHeader />, 'es');
    expect(container.style.getPropertyValue('--app-header-h')).toMatch(/^\d+px$/);
    unmount();
    expect(container.style.getPropertyValue('--app-header-h')).toBe('');
  });
});
