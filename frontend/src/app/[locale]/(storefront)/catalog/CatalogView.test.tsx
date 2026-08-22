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

// StoreTabs y CatalogView leen la query con useSearchParams (pestaña Gradeadas
// ?type=graded y enlaces del Home ?setId=/?productType=). Holder mutable por test.
const { urlParams } = vi.hoisted(() => ({ urlParams: { current: new URLSearchParams() } }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => urlParams.current,
}));

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  urlParams.current = new URLSearchParams();
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

/**
 * Los enlaces del Home llegan con query (?setId=<id>, ?productType=graded):
 * la vista inicializa sus filtros desde la URL al montar y los pinta como
 * chips removibles (mismo estado que si se hubieran elegido en el panel).
 */
describe('CatalogView · filtros iniciales desde la URL (enlaces del Home)', () => {
  it('?setId= y ?productType=graded se aplican al montar (chips activos)', async () => {
    urlParams.current = new URLSearchParams('setId=base1&productType=graded');
    renderWithProviders(<CatalogView />, 'es');

    // Chips removibles de los dos filtros que vinieron en la URL. El chip de set
    // muestra el NOMBRE desde las facetas (QA-1), no el id crudo.
    expect(await screen.findByRole('button', { name: /Base Set/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /graded/ })).toBeInTheDocument();
  });

  it('un productType inválido en la URL se ignora (sin chip, sin romper)', async () => {
    urlParams.current = new URLSearchParams('productType=oro');
    renderWithProviders(<CatalogView />, 'es');

    await screen.findAllByRole('button', { name: 'Añadir al carrito' });
    expect(screen.queryByRole('button', { name: /oro/ })).toBeNull();
  });
});
