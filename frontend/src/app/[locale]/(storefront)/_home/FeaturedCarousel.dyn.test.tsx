import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderWithProviders } from '@/test/render';
import { codigoDe } from '@/test/strip-comments';
import * as api from '@/lib/api';
import type { CardDTO, FeaturedListingDTO, FeaturedSlotKind } from '@/types/contract';
import { FeaturedCarousel, ROTATION_REST_MS } from './FeaturedCarousel';

/**
 * DYN-F1 (API_CONTRACT §DYN.2, §DYN.7; criterios 920, 923, 925, 927, 928; I-1).
 *
 *  - El carrusel lee `GET /catalog/featured` (`getFeatured`), NUNCA la rejilla ordenada por precio, ni de respaldo.
 *  - La etiqueta «Recién llegada» va en las tejas `new_arrival` y solo en ellas.
 *  - La pasada recorre las 10 tejas (la rotación es la de siempre: `ROTATION_REST_MS` no cambia).
 *  - `data: []` ⇒ «sin piezas», sin pedir otra cosa (I-1); un error ⇒ el estado de error, sin respaldo.
 *
 * Mutación que lo pone rojo: volver a `getCatalog({ sort: 'price_desc' })` en el hook.
 */

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function card(id: string, name: string): CardDTO {
  return {
    id,
    externalId: `x-${id}`,
    name,
    number: '1',
    rarity: 'Rare',
    supertype: 'Pokémon',
    subtypes: [],
    setId: 's1',
    setName: 'Set', setPtcgoCode: null,
    imageSmallUrl: `https://img.example/${id}-s.png`,
    imageLargeUrl: `https://img.example/${id}-l.png`,
    availableFinishes: ['normal'],
  };
}

function tile(i: number, slot: FeaturedSlotKind): FeaturedListingDTO {
  return {
    representativeInventoryItemId: `inv-${i}`,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    gradeKey: 'raw:NM',
    stockCount: 1,
    displayPriceCents: 10_000 + i,
    ivaIncluded: true,
    ivaRatePct: 16,
    currency: 'MXN',
    card: card(`c-${i}`, `Carta ${i}`),
    featuredSlot: slot,
  };
}

/** La selección del día de §DYN.1: 2 recién llegadas en los lugares 1-2 + 8 del pool. */
const TEN = Array.from({ length: 10 }, (_, i) => tile(i, i < 2 ? 'new_arrival' : 'pool'));

function tilesOf(container: HTMLElement): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href^="/catalog/c-"]'));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('DYN-F1 · Destacadas del día desde GET /catalog/featured', () => {
  it('el hook llama `getFeatured` y NO `getCatalog`; pinta las 10 en el orden del servidor', async () => {
    const featured = vi.spyOn(api, 'getFeatured').mockResolvedValue({ businessDate: '2026-10-29', data: TEN });
    const catalog = vi.spyOn(api, 'getCatalog');
    const { container } = renderWithProviders(<FeaturedCarousel />, 'es');
    await screen.findByText('Carta 9');
    expect(featured).toHaveBeenCalledTimes(1);
    expect(featured.mock.calls[0]).toEqual([]);
    expect(catalog).not.toHaveBeenCalled();
    expect(tilesOf(container).map((a) => a.getAttribute('href'))).toEqual(TEN.map((t) => `/catalog/${t.card.id}`));
  });

  it('«Recién llegada» SOLO en las tejas `new_arrival` (lugares 1 y 2)', async () => {
    vi.spyOn(api, 'getFeatured').mockResolvedValue({ businessDate: '2026-10-29', data: TEN });
    const { container } = renderWithProviders(<FeaturedCarousel />, 'es');
    await screen.findByText('Carta 9');
    const tiles = tilesOf(container);
    const labelled = tiles.map((a) => a.querySelector('[data-testid="featured-new-arrival"]')?.textContent ?? null);
    expect(labelled).toEqual(['Recién llegada', 'Recién llegada', ...Array(8).fill(null)]);
    // Dentro del enlace ⇒ parte de su nombre accesible.
    expect(tiles[1].textContent).toMatch(/Recién llegada/);
  });

  it('sin recién llegadas (todo `pool`) ⇒ ninguna etiqueta', async () => {
    vi.spyOn(api, 'getFeatured').mockResolvedValue({
      businessDate: '2026-10-29',
      data: TEN.map((t) => ({ ...t, featuredSlot: 'pool' as const })),
    });
    renderWithProviders(<FeaturedCarousel />, 'es');
    await screen.findByText('Carta 9');
    expect(screen.queryByTestId('featured-new-arrival')).toBeNull();
  });

  it('`data: []` (925/927, I-1) ⇒ «sin piezas» y NINGUNA otra petición de respaldo', async () => {
    vi.spyOn(api, 'getFeatured').mockResolvedValue({ businessDate: null, data: [] });
    const catalog = vi.spyOn(api, 'getCatalog');
    renderWithProviders(<FeaturedCarousel />, 'es');
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 30));
    expect(catalog).not.toHaveBeenCalled();
  });

  it('error del endpoint ⇒ estado de error con «Reintentar», sin caer a «las más caras»', async () => {
    vi.spyOn(api, 'getFeatured').mockRejectedValue(new Error('500'));
    const catalog = vi.spyOn(api, 'getCatalog');
    renderWithProviders(<FeaturedCarousel />, 'es');
    expect(await screen.findByRole('button', { name: /Reintentar/ }, { timeout: 8000 })).toBeInTheDocument();
    expect(catalog).not.toHaveBeenCalled();
  });
});

/**
 * Criterio 928: «la pasada recorre 10 tejas en vez de 8». Misma geometría inyectada que
 * `FeaturedCarouselRotation.test.tsx` (jsdom no tiene layout), con 10 tejas: 8 movimientos de una teja hasta el tope y
 * el anuncio del fin. Con la cadencia de siempre (`ROTATION_REST_MS`).
 */
describe('DYN-F1 · la pasada recorre las 10 tejas (928)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('avanza teja a teja hasta mostrar la décima y anuncia el fin', async () => {
    vi.spyOn(api, 'getFeatured').mockResolvedValue({ businessDate: '2026-10-29', data: TEN });
    renderWithProviders(<FeaturedCarousel />, 'es');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const track = screen.getByRole('group', { name: 'Piezas destacadas — pista desplazable' });
    // Geometría: gutter 20, líder 236, chicas 160, hueco 16, viewport 390.
    const children = Array.from(track.children) as HTMLElement[];
    expect(children).toHaveLength(10);
    let x = 20;
    children.forEach((child, i) => {
      const pos = x;
      Object.defineProperty(child, 'offsetLeft', { configurable: true, get: () => pos });
      x += (i === 0 ? 236 : 160) + 16;
    });
    const scrollWidth = x - 16 + 20;
    Object.defineProperty(track, 'offsetLeft', { configurable: true, get: () => 0 });
    Object.defineProperty(track, 'clientLeft', { configurable: true, get: () => 0 });
    Object.defineProperty(track, 'clientWidth', { configurable: true, get: () => 390 });
    Object.defineProperty(track, 'scrollWidth', { configurable: true, get: () => scrollWidth });
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    await act(async () => {
      fireEvent.load(screen.getByAltText('Carta 0'));
    });

    const seen: number[] = [];
    for (let i = 0; i < 12; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ROTATION_REST_MS);
      });
      if (seen[seen.length - 1] !== track.scrollLeft) seen.push(track.scrollLeft);
    }
    const maxScroll = scrollWidth - 390;
    expect(seen).toHaveLength(8);
    expect(seen[seen.length - 1]).toBe(maxScroll);
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Fin de las piezas destacadas.');
  });
});

/**
 * DYN-F1 (fuente): `_home/**` no ordena Destacadas por precio ni las pide a la rejilla. Se lee el código SIN comentarios
 * (un comentario que cite `price_desc` no es una petición). Única excepción declarada: `GradedShelf.tsx`, el estante
 * «Gradeadas» (las 4 gradeadas de más precio), que NO es Destacadas y que §DYN no toca.
 */
describe('DYN-F1 · candado de fuente sobre `_home/**`', () => {
  const dir = join(process.cwd(), 'src/app/[locale]/(storefront)/_home');
  const files = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) ? [p] : [];
    });
  const ALLOW_PRICE_DESC = new Set(['GradedShelf.tsx']);

  it('ningún fichero de `_home/**` (salvo el estante de gradeadas) contiene `price_desc`', () => {
    const offenders = files(dir).filter(
      (p) => !ALLOW_PRICE_DESC.has(p.split('/').pop()!) && /price_desc/.test(codigoDe(p)),
    );
    expect(offenders).toEqual([]);
  });

  it('el carrusel no importa ni llama `getCatalog`; su fuente es `getFeatured`', () => {
    const src = codigoDe(join(dir, 'FeaturedCarousel.tsx'));
    expect(src).not.toMatch(/\bgetCatalog\b/);
    expect(src).not.toMatch(/price_desc/);
    expect(src).toMatch(/queryFn:\s*\(\)\s*=>\s*getFeatured\(\)/);
  });
});
