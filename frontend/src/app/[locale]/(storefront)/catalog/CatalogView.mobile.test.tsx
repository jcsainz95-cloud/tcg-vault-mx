import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { CatalogView } from './CatalogView';

/**
 * MKT-CONV.8 (PROJECT 943, vMKT-CONV-2): cabecera del catálogo plegada en < lg para que quepan ≥ 2 tejas completas
 * con el banner abierto. jsdom no maqueta: aquí se fija la MECÁNICA (clases, roles, nombres accesibles); la geometría
 * la mide L-8 (`e2e/measurement-on.spec.ts`) en el navegador. Lo que se pliega no se pierde: el conteo de resultados
 * pasa a `sr-only` y sigue siendo la región viva; la etiqueta del orden, `sr-only`, sigue nombrando el `<select>`.
 */

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/catalog',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const { urlParams } = vi.hoisted(() => ({ urlParams: { current: new URLSearchParams() } }));
vi.mock('next/navigation', () => ({ useSearchParams: () => urlParams.current }));

const cls = (el: Element) => el.className.split(/\s+/);

beforeEach(() => {
  window.localStorage.clear();
  urlParams.current = new URLSearchParams();
});

describe('CatalogView · cabecera plegada en < lg (MKT-CONV.8)', () => {
  it('eyebrow oculto salvo en lg; h1 de 24/28 px (40 en lg) con el conteo en la MISMA fila', async () => {
    renderWithProviders(<CatalogView />, 'es');
    await screen.findAllByRole('button', { name: 'Añadir al carrito' });

    const eyebrow = screen.getByTestId('catalog-eyebrow');
    expect(cls(eyebrow)).toEqual(expect.arrayContaining(['hidden', 'lg:block']));

    const h1 = screen.getByRole('heading', { level: 1 });
    expect(cls(h1)).toEqual(expect.arrayContaining(['text-[24px]', 'leading-[28px]', 'lg:text-[40px]']));
    // El contenedor de título y conteo es una fila en todos los anchos (antes `flex-col` en < sm).
    const header = h1.parentElement!.parentElement!;
    expect(cls(header)).toContain('flex-row');
    expect(cls(header)).not.toContain('flex-col');
    expect(within(header).getByText(/publicaci(ón|ones) disponibles?/i)).toBeInTheDocument();
    expect(cls(header)).toEqual(expect.arrayContaining(['pt-4', 'pb-2', 'lg:pt-10', 'lg:pb-6']));
  });

  it('conteo de resultados: región viva `role=status`, `sr-only` en < lg y visible en lg', async () => {
    renderWithProviders(<CatalogView />, 'es');
    await screen.findAllByRole('button', { name: 'Añadir al carrito' });
    const count = screen.getByTestId('catalog-results-count');
    expect(count).toHaveAttribute('role', 'status');
    expect(count).toHaveAttribute('aria-live', 'polite');
    expect(cls(count)).toEqual(expect.arrayContaining(['sr-only', 'lg:not-sr-only']));
    expect(count.textContent).toMatch(/\d/);
  });

  it('sin chips la barra de resultados no ocupa alto en < lg; con chips es UNA fila de 48 px sin wrap', async () => {
    const { unmount } = renderWithProviders(<CatalogView />, 'es');
    await screen.findAllByRole('button', { name: 'Añadir al carrito' });
    const bar = () => document.getElementById('catalogo-resultados')!;
    expect(cls(bar())).toContain('h-0');
    expect(cls(bar())).not.toContain('border-b');
    expect(cls(bar())).toEqual(expect.arrayContaining(['lg:h-auto', 'lg:py-4', 'lg:border-b']));
    unmount();

    urlParams.current = new URLSearchParams('productType=graded');
    renderWithProviders(<CatalogView />, 'es');
    await screen.findByRole('button', { name: 'Quitar filtro Graded' });
    expect(cls(bar())).toEqual(expect.arrayContaining(['h-12', 'flex-nowrap', 'overflow-x-auto', 'border-b']));
  });

  it('Filtros + Orden en una fila de 56 px; la etiqueta del orden `sr-only` sigue nombrando el control', async () => {
    renderWithProviders(<CatalogView />, 'es');
    await screen.findAllByRole('button', { name: 'Añadir al carrito' });
    const row = screen.getByTestId('catalog-mobile-actions');
    expect(cls(row)).toEqual(expect.arrayContaining(['py-1.5', 'items-center', 'lg:hidden']));
    const select = within(row).getByRole('combobox', { name: 'Ordenar' });
    const label = row.querySelector(`label[for="${select.id}"]`)!;
    expect(cls(label)).toContain('sr-only');
    expect(cls(select.parentElement!)).toContain('h-11');
    expect(cls(within(row).getByRole('button', { name: /Filtros/ }))).toContain('h-11');
  });

  it('la rejilla arranca con `pt-3` en < lg (antes `pt-8`) y `pt-8` en lg', async () => {
    renderWithProviders(<CatalogView />, 'es');
    const [first] = await screen.findAllByRole('button', { name: 'Añadir al carrito' });
    let grid: HTMLElement | null = first;
    while (grid && !cls(grid).includes('grid-cols-2')) grid = grid.parentElement;
    expect(grid).not.toBeNull();
    expect(cls(grid!)).toEqual(expect.arrayContaining(['pt-3', 'lg:pt-8']));
    expect(cls(grid!)).not.toContain('pt-8');
  });
});
