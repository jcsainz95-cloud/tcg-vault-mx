import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import es from '../../../../../messages/es.json';
import * as api from '@/lib/api';
import type { CardDTO, GroupedListingListResponse, GroupedListingSummaryDTO } from '@/types/contract';
import { QUERY_DEFAULTS } from '@/components/Providers';
import { CatalogView, initialDataUpdatedAtOf } from './CatalogView';
import { responseAgeMs } from '@/lib/catalog-ssr';

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
// `responseAgeMs` vive en `lib/catalog-ssr.ts`, que usa `cache()` de React (solo en el build de servidor): identidad.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <F,>(fn: F) => fn,
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
  client = new QueryClient({ defaultOptions: { queries: { ...QUERY_DEFAULTS, retry: false } } }),
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
    const { unmount } = render(wrap(<CatalogView initialPage={{ filters: {}, data: PAGE1, ageMs: 0 }} />));
    expect(await screen.findByText(`Carta ${PAGE1.data[0].card.id}`)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(getCatalog).not.toHaveBeenCalled();
    unmount();

    // La URL pide la página 3 pero la lectura del servidor era de otros filtros ⇒ no se usa: se pide la 3.
    urlParams.current = new URLSearchParams('page=3');
    render(wrap(<CatalogView initialPage={{ filters: {}, data: PAGE1, ageMs: 0 }} />));
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

/**
 * B-R2 (QA sobre `e066b0b5`, medido 10/10): la caché de datos de Next es stale-while-revalidate. Tras > 30 s sin visitas
 * sirve la copia VIEJA a la primera visita; sin su edad, react-query la daba por fresca (`staleTime` 30 s) y no releía:
 * el catálogo mostraba MX$1,510.00 y el checkout cobraba MX$1,601.00. Con `ageMs` (cabecera `Date` del backend, que la
 * caché guarda) la vista relee al hidratar si el dato ya no es fresco, y no relee si lo es.
 *
 * Mutación que lo pone rojo: quitar `initialDataUpdatedAt` del `useQuery` del catálogo ⇒ la copia de 31 s no se relee.
 */
describe('B-R2 · la página del servidor trae su edad y la vista revalida si es vieja', () => {
  const NEWER: GroupedListingListResponse = {
    ...PAGE1,
    data: PAGE1.data.map((g, i) => (i === 0 ? { ...g, displayPriceCents: 160_100 } : g)),
  };

  it('copia servida con 31 s de edad ⇒ relee al montar y la teja pasa al precio nuevo', async () => {
    const getCatalog = vi.spyOn(api, 'getCatalog').mockResolvedValue(NEWER);
    render(wrap(<CatalogView initialPage={{ filters: {}, data: PAGE1, ageMs: 31_000 }} />));
    await waitFor(() => expect(getCatalog).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/1,601\.00/)).toBeInTheDocument();
  });

  it('edad desconocida (sin cabecera `Date`) ⇒ se trata como vieja y relee', async () => {
    const getCatalog = vi.spyOn(api, 'getCatalog').mockResolvedValue(PAGE1);
    render(wrap(<CatalogView initialPage={{ filters: {}, data: PAGE1, ageMs: null }} />));
    await waitFor(() => expect(getCatalog).toHaveBeenCalledTimes(1));
  });

  it('copia de 29 s ⇒ aún fresca: 0 relecturas', async () => {
    const getCatalog = vi.spyOn(api, 'getCatalog').mockResolvedValue(PAGE1);
    render(wrap(<CatalogView initialPage={{ filters: {}, data: PAGE1, ageMs: 29_000 }} />));
    expect(await screen.findByText(`Carta ${PAGE1.data[0].card.id}`)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(getCatalog).not.toHaveBeenCalled();
  });

  it('initialDataUpdatedAtOf: por edad, nunca negativo, desconocida ⇒ 0', () => {
    expect(initialDataUpdatedAtOf(31_000, 100_000)).toBe(69_000);
    expect(initialDataUpdatedAtOf(null, 100_000)).toBe(0);
    expect(initialDataUpdatedAtOf(undefined, 100_000)).toBe(0);
    expect(initialDataUpdatedAtOf(200_000, 100_000)).toBe(0);
  });

  /**
   * ARCHITECTURE §4.DYN (f) 9: «edad desconocida, ilegible o negativa = vieja». Defensa en la propia conversión, no
   * solo en `responseAgeMs`: un `ageMs` negativo que llegue por otra vía no puede dar `now + |ageMs|` (fresco).
   * Mutación: volver a `ageMs == null ? 0 : Math.max(0, now - ageMs)` ⇒ rojo.
   */
  it('§4.DYN (f) 9 · initialDataUpdatedAtOf: edad negativa o no finita ⇒ 0 (vieja)', () => {
    expect(initialDataUpdatedAtOf(-5_000, 100_000)).toBe(0);
    expect(initialDataUpdatedAtOf(-1, 100_000)).toBe(0);
    expect(initialDataUpdatedAtOf(Number.NaN, 100_000)).toBe(0);
    expect(initialDataUpdatedAtOf(Number.NEGATIVE_INFINITY, 100_000)).toBe(0);
    expect(initialDataUpdatedAtOf(0, 100_000)).toBe(100_000);
  });

  /**
   * ARCHITECTURE §4.DYN (f) 9 (v1.115, TL-MKT2-8): una edad NEGATIVA (cabecera `Date` en el futuro) es DESCONOCIDA, o
   * sea vieja. La conversión vive en `responseAgeMs` (`lib/catalog-ssr.ts`), que es lo único que produce `ageMs`; aquí
   * se fija la cadena entera, de la cabecera a la relectura, sin tocar el componente.
   * Mutación: `responseAgeMs` vuelve a `Math.max(0, now - readAt)` ⇒ la copia «del futuro» pasa por fresca y no relee.
   */
  it('§4.DYN (f) 9 · Date en el futuro ⇒ edad desconocida ⇒ updatedAt 0 y relee al montar', async () => {
    const now = Date.now();
    const ageMs = responseAgeMs(new Date(now + 60_000).toUTCString(), now);
    expect(ageMs).toBeNull();
    expect(initialDataUpdatedAtOf(ageMs, now)).toBe(0);
    const getCatalog = vi.spyOn(api, 'getCatalog').mockResolvedValue(PAGE1);
    render(wrap(<CatalogView initialPage={{ filters: {}, data: PAGE1, ageMs }} />));
    expect(await screen.findByText(`Carta ${PAGE1.data[0].card.id}`)).toBeInTheDocument();
    await waitFor(() => expect(getCatalog).toHaveBeenCalledTimes(1));
  });
});
