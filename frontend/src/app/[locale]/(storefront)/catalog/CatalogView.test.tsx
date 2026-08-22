import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { CatalogView } from './CatalogView';

// Aisla la vista del router de Next (mismo patrón que BuylistView.test).
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// StoreTabs y CatalogView leen ?type=graded con useSearchParams (pestaña Gradeadas).
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/**
 * Feedback al agregar desde la vitrina: el CTA vive en la teja propia de la
 * vista (CatalogTile, makeover 1a) y la confirmación es el toast (§7.5) +
 * el estado «En el carrito» de la teja (N-17).
 */
describe('CatalogView · toast de confirmación al agregar', () => {
  it('clic en «Añadir al carrito» guarda la pieza y muestra el toast con enlace al carrito', async () => {
    renderWithProviders(<CatalogView />, 'es');

    // La región aria-live existe desde el inicio, vacía.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    const addButtons = await screen.findAllByRole('button', { name: 'Añadir al carrito' });
    fireEvent.click(addButtons[0]);

    expect(screen.getByRole('status')).toHaveTextContent('Agregado al carrito');
    expect(screen.getByRole('link', { name: 'Ver carrito' })).toHaveAttribute('href', '/checkout');
    // Formato v2 del carrito: { ids, updatedAt } (expiración a 30 días).
    expect(JSON.parse(window.localStorage.getItem('tcg.cart')!).ids).toHaveLength(1);
  });
});
