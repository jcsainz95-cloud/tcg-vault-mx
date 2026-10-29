import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import es from '../../../../messages/es.json';
import * as api from '@/lib/api';
import type { CardDTO, FeaturedListingDTO, GroupedListingSummaryDTO } from '@/types/contract';
import { HOME_SSR_BUDGET_MS } from '@/lib/home-queries';
import { leadImageOf, loadHomeForSSR, withBudget } from '@/lib/home-ssr';
import HomePage from './page';

/**
 * DYN-F2 (API_CONTRACT §DYN.6.2, criterios 936-937) — la portada pide Destacadas y la vitrina EN EL SERVIDOR y pinta las
 * tejas en el HTML (la `<img>` líder presente); si el API no llega en 400 ms (o falla), el HTML sale con el MARCO de
 * Destacadas (alto reservado) y el cliente rellena. Se renderiza la página de servidor a HTML (`renderToString`): es lo
 * que recibe un navegador sin JS.
 *
 * Mutación que lo pone rojo: volver a `useQuery` sin datos iniciales (la página no hidrata) ⇒ el HTML no trae tejas.
 */

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>();
  return { ...actual, useSession: () => ({ user: null, isAuthenticated: false, ready: true }) };
});

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
    setName: 'Set', setPtcgoCode: null,
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
const FEATURED: FeaturedListingDTO[] = ['f0', 'f1', 'f2'].map((id, i) => ({ ...grp(id), featuredSlot: i === 0 ? 'new_arrival' : 'pool' }));
const GEMS = [{ ...grp('g0'), gradingHighlight: [] }] as GroupedListingSummaryDTO[];

const never = <T,>() => new Promise<T>(() => {});

async function serverHtml(): Promise<string> {
  const page = await HomePage();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="es" messages={es}>
        {page}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getCatalogFacets').mockImplementation(never);
  vi.spyOn(api, 'getSealedGroups').mockImplementation(never);
  vi.spyOn(api, 'getPublicBounties').mockImplementation(never);
});

describe('DYN-F2 · la portada sale del servidor con Destacadas en el HTML', () => {
  it('con datos a tiempo: la pista `#piezas-destacadas-pista` con su `<img>` líder (foto grande) y la etiqueta', async () => {
    const featured = vi.spyOn(api, 'getFeatured').mockResolvedValue({ businessDate: '2026-10-29', data: FEATURED });
    const catalog = vi.spyOn(api, 'getCatalog').mockImplementation(async (f = {}) => {
      const data = f.gradingHighlight ? GEMS : [];
      return { data, page: 1, pageSize: 8, total: data.length };
    });
    const html = await serverHtml();
    expect(html).toMatch(/id="piezas-destacadas-pista"/);
    const track = html.slice(html.indexOf('id="piezas-destacadas-pista"'));
    expect(track).toMatch(/<img[^>]*src="https:\/\/img\.example\/f0-l\.png"/);
    expect(track).toContain('Recién llegada');
    expect(html).not.toContain('data-testid="featured-frame"');
    // La lectura de servidor usa la caché de datos de Next (30 s, etiqueta `featured`) — mismos endpoints que el cliente.
    expect(featured).toHaveBeenCalledWith({ next: { revalidate: 30, tags: ['featured'] } });
    expect(catalog).toHaveBeenCalledWith(
      { gradingHighlight: true, sort: 'grading_showcase', pageSize: 8 },
      { next: { revalidate: 30, tags: ['showcase'] } },
    );
  });

  it('la vitrina también sale en el HTML cuando trae elegibles', async () => {
    vi.spyOn(api, 'getFeatured').mockResolvedValue({ businessDate: '2026-10-29', data: FEATURED });
    vi.spyOn(api, 'getCatalog').mockImplementation(async (f = {}) => {
      const data = f.gradingHighlight ? GEMS : [];
      return { data, page: 1, pageSize: 8, total: data.length };
    });
    const html = await serverHtml();
    expect(html).toMatch(/id="joyas-para-gradear"/);
    expect(html).toContain('Carta g0');
  });

  it('API lento (> 400 ms): NO espera — el HTML sale con el MARCO de Destacadas (alto reservado), sin tejas', async () => {
    vi.spyOn(api, 'getFeatured').mockImplementation(never);
    vi.spyOn(api, 'getCatalog').mockImplementation(never);
    const t0 = Date.now();
    const html = await serverHtml();
    const took = Date.now() - t0;
    expect(took).toBeLessThan(HOME_SSR_BUDGET_MS + 600);
    expect(html).toContain('data-testid="featured-frame"');
    expect(html).not.toMatch(/id="piezas-destacadas-pista"/);
    // El marco reserva foto + líneas de texto de cada teja.
    expect(html).toMatch(/featured-frame[\s\S]*aspect-\[5\/7\]/);
  });

  it('API en error (503): el HTML sale igual, con el marco', async () => {
    vi.spyOn(api, 'getFeatured').mockRejectedValue(new Error('503'));
    vi.spyOn(api, 'getCatalog').mockRejectedValue(new Error('503'));
    const html = await serverHtml();
    expect(html).toContain('data-testid="featured-frame"');
    expect(html).toContain('Caza la carta. Nosotros la guardamos.');
  });
});

describe('DYN-F2 · el cargador de servidor', () => {
  it('`withBudget`: valor a tiempo, `null` si tarda o si falla', async () => {
    expect(await withBudget(Promise.resolve(1), 50)).toBe(1);
    expect(await withBudget(never<number>(), 20)).toBeNull();
    expect(await withBudget(Promise.reject(new Error('x')), 50)).toBeNull();
  });

  it('las dos lecturas van en PARALELO (el tope no se suma)', async () => {
    vi.spyOn(api, 'getFeatured').mockImplementation(never);
    vi.spyOn(api, 'getCatalog').mockImplementation(never);
    const t0 = Date.now();
    const r = await loadHomeForSSR(100);
    expect(Date.now() - t0).toBeLessThan(180);
    expect(r).toEqual({ featured: null, gems: null });
  });

  it('`leadImageOf`: la foto grande de la teja 1, o la chica si no hay grande', () => {
    expect(leadImageOf({ businessDate: 'x', data: FEATURED })).toBe('https://img.example/f0-l.png');
    expect(
      leadImageOf({ businessDate: 'x', data: [{ ...FEATURED[0], card: { ...FEATURED[0].card, imageLargeUrl: null as unknown as string } }] }),
    ).toBe('https://img.example/f0-s.png');
    expect(leadImageOf(null)).toBeNull();
    expect(leadImageOf({ businessDate: null, data: [] })).toBeNull();
  });
});
