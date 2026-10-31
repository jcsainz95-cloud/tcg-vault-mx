import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import es from '../../../../../messages/es.json';
import * as api from '@/lib/api';
import type { CatalogFacetsDTO, CardDTO, GroupedListingListResponse, GroupedListingSummaryDTO } from '@/types/contract';
import { CatalogView } from './CatalogView';

/**
 * Rechazo del techlead sobre `561ad425` (stream `claude/mkt-conversion`):
 *  · R1 / MK-D5 — filtrar → paginar → recargar conserva filtro Y página (antes la URL solo llevaba `?page=`).
 *  · R1 — la lectura del servidor vale para su clave aunque los filtros lleguen en otro orden de campos.
 *  · MK-D8 — «Limpiar filtros» dentro de la ventana de 300 ms del debounce borra también el término pendiente.
 *  · MK-D4 — los chips pintan la etiqueta traducida del tipo y del acabado, no el valor crudo del enum.
 */

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/catalog',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? `/es${href}` : '#'} {...props}>
      {children}
    </a>
  ),
}));
// Como en Next 15: `useSearchParams` refleja la barra de direcciones (también lo escrito con `history`).
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

function card(id: string): CardDTO {
  return {
    id,
    externalId: `x-${id}`,
    name: `Carta ${id}`,
    number: '1',
    rarity: 'Rare',
    supertype: 'Pokémon',
    subtypes: [],
    setId: 'base1',
    setName: 'Base Set',
    setPtcgoCode: null,
    imageSmallUrl: `https://img.example/${id}-s.png`,
    imageLargeUrl: `https://img.example/${id}-l.png`,
    availableFinishes: ['normal'],
  };
}
function grp(id: string): GroupedListingSummaryDTO {
  return {
    representativeInventoryItemId: `inv-${id}`,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    gradeKey: 'raw:NM',
    stockCount: 1,
    displayPriceCents: 10_000,
    ivaIncluded: true,
    ivaRatePct: 16,
    currency: 'MXN',
    card: card(id),
  };
}
const PAGE: GroupedListingListResponse = {
  data: ['0b1c2d3e-0000-4000-8000-000000000001', '0b1c2d3e-0000-4000-8000-000000000002'].map(grp),
  page: 1,
  pageSize: 20,
  total: 45,
};
const FACETS: CatalogFacetsDTO = {
  rarities: ['Rare'],
  sets: [{ id: 'base1', name: 'Base Set', year: 1999 }],
  productTypes: ['raw', 'graded'],
  sealedSubtypes: [],
  finishes: ['normal', 'holofoil'],
  price: { minCents: 0, maxCents: 100_000, currency: 'MXN' },
};

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="es" messages={es}>
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/es/catalog');
  vi.spyOn(api, 'getCatalogFacets').mockResolvedValue(FACETS);
});

describe('R1 / MK-D5 · la URL lleva los filtros del panel', () => {
  it('filtrar por set → página 2 → recargar conserva el set y la página (y la flecha los lleva en su href)', async () => {
    const getCatalog = vi.spyOn(api, 'getCatalog').mockResolvedValue(PAGE);
    const first = render(wrap(<CatalogView />));
    fireEvent.click((await screen.findAllByRole('option', { name: /Base Set/ }))[0]);
    await waitFor(() => expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ setId: 'base1' })));
    // El filtro ya está en la barra de direcciones: recargar en la página 1 también lo conservaría.
    await waitFor(() => expect(window.location.search).toBe('?setId=base1'));

    // Ctrl+clic en la flecha: su href lleva el filtro, no solo la página.
    const next = await screen.findByRole('link', { name: es.catalog.pagination.next });
    expect(next).toHaveAttribute('href', '/es/catalog?setId=base1&page=2');
    fireEvent.click(next);
    await waitFor(() =>
      expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ setId: 'base1', page: 2 })),
    );
    expect(window.location.search).toBe('?setId=base1&page=2');

    // «Recargar»: una vista nueva que solo tiene la URL.
    first.unmount();
    getCatalog.mockClear();
    render(wrap(<CatalogView />));
    await waitFor(() =>
      expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ setId: 'base1', page: 2 })),
    );
    expect(getCatalog).not.toHaveBeenCalledWith(expect.not.objectContaining({ setId: 'base1' }));
    expect(await screen.findByRole('button', { name: 'Quitar filtro Base Set' })).toBeInTheDocument();
  });

  it('atrás (popstate) toma la URL entera; una navegación con query (pestaña) se mergea sobre el panel', async () => {
    window.history.replaceState(null, '', '/es/catalog?setId=base1&page=2');
    const getCatalog = vi.spyOn(api, 'getCatalog').mockResolvedValue(PAGE);
    const view = render(wrap(<CatalogView />));
    await screen.findByRole('button', { name: 'Quitar filtro Base Set' });

    // Pestaña «Gradeadas» (enlace `/catalog?type=graded`, sin popstate): se conserva el set del panel.
    window.history.pushState(null, '', '/es/catalog?type=graded');
    view.rerender(wrap(<CatalogView />));
    await waitFor(() =>
      expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ setId: 'base1', productType: 'graded' })),
    );
    await waitFor(() => expect(window.location.search).toBe('?setId=base1&productType=graded'));

    // Atrás a una URL sin filtros: el set se va (la URL manda también en lo que quita).
    window.history.replaceState(null, '', '/es/catalog');
    window.dispatchEvent(new PopStateEvent('popstate'));
    view.rerender(wrap(<CatalogView />));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Quitar filtro Base Set' })).toBeNull());
    expect(getCatalog).toHaveBeenLastCalledWith(expect.not.objectContaining({ setId: 'base1' }));
    expect(window.location.search).toBe('');
  });

  it('la lectura del servidor vale para su clave aunque los campos vengan en otro orden (sin doble lectura)', async () => {
    window.history.replaceState(null, '', '/es/catalog?setId=base1&productType=graded');
    const getCatalog = vi.spyOn(api, 'getCatalog').mockResolvedValue(PAGE);
    render(wrap(<CatalogView initialPage={{ filters: { productType: 'graded', setId: 'base1' }, data: PAGE }} />));
    expect(await screen.findByText(`Carta ${PAGE.data[0].card.id}`)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(getCatalog).not.toHaveBeenCalled();
  });
});

describe('MK-D8 · «Limpiar filtros» dentro de la ventana del debounce', () => {
  it('borra el término pendiente: ni queda en el input ni entra como filtro después', async () => {
    window.history.replaceState(null, '', '/es/catalog?setId=base1');
    const getCatalog = vi.spyOn(api, 'getCatalog').mockResolvedValue(PAGE);
    render(wrap(<CatalogView />));
    await screen.findByRole('button', { name: 'Quitar filtro Base Set' });
    const input = screen.getAllByRole('searchbox')[0] as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'pika' } });
    // Antes de 300 ms:
    fireEvent.click(screen.getAllByRole('button', { name: es.common.clearFilters })[0]);
    await new Promise((r) => setTimeout(r, 450));
    expect(input.value).toBe('');
    expect(getCatalog).not.toHaveBeenCalledWith(expect.objectContaining({ q: 'pika' }));
    expect(window.location.search).not.toContain('q=');
  });
});

describe('MK-D4 · chips con etiqueta traducida', () => {
  it('tipo y acabado se pintan con su etiqueta del panel, no con el enum crudo', async () => {
    window.history.replaceState(null, '', '/es/catalog?productType=graded&finish=holofoil');
    vi.spyOn(api, 'getCatalog').mockResolvedValue(PAGE);
    render(wrap(<CatalogView />));
    expect(
      await screen.findByRole('button', { name: `Quitar filtro ${es.shop.type.graded}` }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Quitar filtro ${es.finish.holofoil}` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar filtro graded' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quitar filtro holofoil' })).toBeNull();
  });
});

/**
 * QA sobre `561ad425`:
 *  · M-2 — `?page=99` decía «33 resultados · Ninguna carta coincide» y no dejaba volver: ahora dice que esa página no
 *    existe y enlaza (rastreable) a la página 1 conservando los filtros.
 *  · M-3 — buscar → paginar → recargar conserva el término y la página (lo cerró R1 en `815d14d1`; esto lo fija).
 */
describe('M-2 · página fuera de rango', () => {
  it('?page=99 con 33 resultados: no dice «Ninguna carta coincide» y enlaza a la página 1 con los filtros', async () => {
    window.history.replaceState(null, '', '/es/catalog?setId=base1&page=99');
    const getCatalog = vi
      .spyOn(api, 'getCatalog')
      .mockImplementation(async (f) => (f?.page === 99 ? { data: [], page: 99, pageSize: 20, total: 33 } : PAGE));
    render(wrap(<CatalogView />));
    const back = await screen.findByRole('link', { name: es.catalog.pageOutOfRange.action });
    expect(screen.queryByText(es.catalog.emptyTitle)).toBeNull();
    expect(screen.getByText(es.catalog.pageOutOfRange.title)).toBeInTheDocument();
    expect(back).toHaveAttribute('href', '/es/catalog?setId=base1');
    fireEvent.click(back);
    await waitFor(() => expect(window.location.search).toBe('?setId=base1'));
    expect(getCatalog).toHaveBeenLastCalledWith(expect.objectContaining({ setId: 'base1', page: undefined }));
    expect(await screen.findByText(`Carta ${PAGE.data[0].card.id}`)).toBeInTheDocument();
  });

  it('sin resultados de verdad (total 0) sigue diciendo «Ninguna carta coincide»', async () => {
    vi.spyOn(api, 'getCatalog').mockResolvedValue({ data: [], page: 1, pageSize: 20, total: 0 });
    render(wrap(<CatalogView />));
    expect(await screen.findByText(es.catalog.emptyTitle)).toBeInTheDocument();
    expect(screen.queryByText(es.catalog.pageOutOfRange.title)).toBeNull();
  });
});

describe('M-3 · búsqueda + paginar + recargar', () => {
  it('buscar «pika» → página 2 → recargar conserva el término (en la lectura y en el input) y la página', async () => {
    const getCatalog = vi.spyOn(api, 'getCatalog').mockResolvedValue(PAGE);
    const first = render(wrap(<CatalogView />));
    fireEvent.change(screen.getAllByRole('searchbox')[0], { target: { value: 'pika' } });
    await waitFor(() => expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ q: 'pika' })));
    await waitFor(() => expect(window.location.search).toBe('?q=pika'));
    const next = await screen.findByRole('link', { name: es.catalog.pagination.next });
    expect(next).toHaveAttribute('href', '/es/catalog?q=pika&page=2');
    fireEvent.click(next);
    await waitFor(() => expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ q: 'pika', page: 2 })));
    expect(window.location.search).toBe('?q=pika&page=2');

    first.unmount();
    getCatalog.mockClear();
    render(wrap(<CatalogView />));
    await waitFor(() => expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ q: 'pika', page: 2 })));
    expect((screen.getAllByRole('searchbox')[0] as HTMLInputElement).value).toBe('pika');
    expect(getCatalog).not.toHaveBeenCalledWith(expect.not.objectContaining({ q: 'pika' }));
  });
});
