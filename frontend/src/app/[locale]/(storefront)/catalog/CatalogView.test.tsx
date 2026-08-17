import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { CatalogView } from './CatalogView';

// Aisla la vista del router de Next (mismo patrón que BuylistView.test).
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/**
 * Feedback al agregar desde la vitrina: el botón del card vive en ListingCard
 * (zona compartida de otro stream, sin prop de estado «en carrito»), así que
 * la confirmación de la vitrina es el toast (DESIGN_SYSTEM §7.5).
 */
describe('CatalogView · toast de confirmación al agregar', () => {
  it('clic en «Agregar» guarda la pieza y muestra el toast con enlace al carrito', async () => {
    renderWithProviders(<CatalogView />, 'es');

    // La región aria-live existe desde el inicio, vacía.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    const addButtons = await screen.findAllByRole('button', { name: 'Agregar' });
    fireEvent.click(addButtons[0]);

    expect(screen.getByRole('status')).toHaveTextContent('Agregado al carrito');
    expect(screen.getByRole('link', { name: 'Ver carrito' })).toHaveAttribute('href', '/checkout');
    expect(JSON.parse(window.localStorage.getItem('tcg.cart')!)).toHaveLength(1);
  });
});
