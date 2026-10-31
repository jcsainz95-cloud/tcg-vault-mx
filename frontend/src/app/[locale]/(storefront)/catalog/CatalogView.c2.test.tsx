import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import es from '../../../../../messages/es.json';
import * as api from '@/lib/api';
import type { CardDTO, GroupedListingListResponse, GroupedListingSummaryDTO } from '@/types/contract';
import { CatalogView } from './CatalogView';

/**
 * C2 (BRIEF_MKT Ola 2, criterio 950) — el catálogo sale del SERVIDOR con su primera página: la vista toma la lectura
 * de `page.tsx` como `initialData` de SU clave (mismos filtros), pinta las tejas con `<a href>` a cada ficha y el
 * paginador rastreable, y no repite la lectura al montar. Paginar escribe `?page=` en la URL sin viaje al servidor.
 * El HTML crudo de `next start` contra el stack real lo cubre `e2e/seo-raw-html.spec.ts`.
 *
 * Mutación que lo pone rojo: no pasar `initialData` al `useQuery` del catálogo ⇒ el HTML del servidor sale con el
 * esqueleto (0 enlaces) y el cliente vuelve a pedir la página.
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
const { urlParams } = vi.hoisted(() => ({ urlParams: { current: new URLSearchParams() } }));
vi.mock('next/navigation', () => ({ useSearchParams: () => urlParams.current }));

function card(id: string): CardDTO {
  return {
    id,
    externalId: `x-${id}`,
    name: `Carta ${id}`,
    number: '1',
    rarity: 'Rare',
    supertype: 'Pokémon',
    subtypes: [],
    setId: 's1',
    setName: 'Set',
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
const PAGE1: GroupedListingListResponse = {
  data: ['0b1c2d3e-0000-4000-8000-000000000001', '0b1c2d3e-0000-4000-8000-000000000002'].map(grp),
  page: 1,
  pageSize: 20,
  total: 45,
};
const never = <T,>() => new Promise<T>(() => {});

// Mismas opciones por defecto que la app (`components/Providers.tsx`: `staleTime` 30 s): de ellas depende no repetir.
function wrap(
  node: React.ReactNode,
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } }),
) {
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
  urlParams.current = new URLSearchParams();
  vi.spyOn(api, 'getCatalogFacets').mockImplementation(never);
  window.history.replaceState(null, '', '/es/catalog');
});

describe('C2 · catálogo servido con su primera página', () => {
  it('el HTML del servidor trae las tejas con <a href> a la ficha y el paginador rastreable', () => {
    vi.spyOn(api, 'getCatalog').mockImplementation(never);
    const html = renderToString(wrap(<CatalogView initialPage={{ filters: {}, data: PAGE1 }} />));
    for (const g of PAGE1.data) expect(html).toContain(`href="/es/catalog/${g.card.id}"`);
    expect(html).toContain('href="/es/catalog?page=2"');
    expect(html).not.toContain(es.catalog.emptyTitle);
  });

  it('con la misma clave no repite la lectura al montar; con otros filtros, sí', async () => {
    const getCatalog = vi.spyOn(api, 'getCatalog').mockResolvedValue(PAGE1);
    const { unmount } = render(wrap(<CatalogView initialPage={{ filters: {}, data: PAGE1 }} />));
    expect(await screen.findByText(`Carta ${PAGE1.data[0].card.id}`)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(getCatalog).not.toHaveBeenCalled();
    unmount();

    // La URL pide la página 3 pero la lectura del servidor era de otros filtros ⇒ no se usa: se pide la 3.
    urlParams.current = new URLSearchParams('page=3');
    render(wrap(<CatalogView initialPage={{ filters: {}, data: PAGE1 }} />));
    await waitFor(() => expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ page: 3 })));
  });

  it('paginar pide la página siguiente y la escribe en la URL (?page=2) sin navegar', async () => {
    const getCatalog = vi.spyOn(api, 'getCatalog').mockResolvedValue({ ...PAGE1, page: 2 });
    const push = vi.spyOn(window.history, 'pushState');
    render(wrap(<CatalogView initialPage={{ filters: {}, data: PAGE1 }} />));
    fireEvent.click(await screen.findByRole('link', { name: es.catalog.pagination.next }));
    await waitFor(() => expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
    expect(push).toHaveBeenCalledWith(null, '', '/es/catalog?page=2');
  });
});
