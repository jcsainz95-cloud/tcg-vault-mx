import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTranslator } from 'next-intl';
import es from '../../../../../messages/es.json';
import en from '../../../../../messages/en.json';

/*
 * ARCHITECTURE §13.8 (d) (v1.115⟨mkt-conv2⟩, TL-MKT2-7) — canonical, `hreflang` y `robots` del catálogo paginado,
 * medidos en `generateMetadata` de `catalog/page.tsx` (lo que Next pinta en el `<head>` del servidor). El HTML crudo
 * contra el stack real lo cubre `e2e/seo-raw-html.spec.ts`.
 *
 * Mutaciones que lo ponen rojo: canonical fijo `/catalog` (lo de antes) ⇒ «?page=2 sin filtros»; sin `robots` ⇒
 * «fuera de rango»; tratar un filtro como «sin filtros» ⇒ los casos de filtro/búsqueda/orden.
 */
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <F,>(fn: F) => fn,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
    createTranslator({ locale, messages: locale === 'en' ? en : es, namespace } as never),
}));
const ssr = vi.hoisted(() => ({
  page: { total: 45, pageSize: 20 } as { total: number; pageSize: number } | null,
  calls: 0,
}));
vi.mock('@/lib/catalog-ssr', () => ({
  loadCatalogPageForSSR: async () => {
    ssr.calls += 1;
    return ssr.page ? { data: { data: [], page: 1, pageSize: ssr.page.pageSize, total: ssr.page.total }, ageMs: 0 } : null;
  },
}));

// Solo se mide la metadata: la vista y los envoltorios de la página no entran.
vi.mock('./CatalogView', () => ({ CatalogView: () => null }));
vi.mock('@/components/i18n/RouteMessages', () => ({ RouteMessages: () => null }));
vi.mock('@/components/seo/JsonLd', () => ({ JsonLd: () => null }));

import { generateMetadata } from './page';

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tcghunt.mx').replace(/\/+$/, '');

async function meta(locale: 'es' | 'en', query: Record<string, string | undefined>) {
  return generateMetadata({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(query) });
}

beforeEach(() => {
  ssr.page = { total: 45, pageSize: 20 }; // 3 páginas
  ssr.calls = 0;
});

describe('§13.8 (d) · canonical del catálogo paginado (generateMetadata)', () => {
  it('sin filtros, ?page=2 ⇒ canonical propio /{locale}/catalog?page=2 y hreflang con la misma page; indexable', async () => {
    for (const locale of ['es', 'en'] as const) {
      const m = await meta(locale, { page: '2' });
      expect(m.alternates?.canonical).toBe(`${SITE}/${locale}/catalog?page=2`);
      expect(m.alternates?.languages).toEqual({
        es: `${SITE}/es/catalog?page=2`,
        en: `${SITE}/en/catalog?page=2`,
        'x-default': `${SITE}/es/catalog?page=2`,
      });
      expect((m.openGraph as { url?: string }).url).toBe(`${SITE}/${locale}/catalog?page=2`);
      expect(m.robots).toBeUndefined();
    }
    // La última página existente también.
    expect((await meta('es', { page: '3' })).alternates?.canonical).toBe(`${SITE}/es/catalog?page=3`);
  });

  it('page 1, ausente o inválida ⇒ /catalog (sin leer el catálogo en metadata)', async () => {
    for (const q of [{}, { page: '1' }, { page: '0' }, { page: 'abc' }, { page: '-2' }, { page: '2.5' }]) {
      const m = await meta('es', q);
      expect(m.alternates?.canonical, JSON.stringify(q)).toBe(`${SITE}/es/catalog`);
      expect(m.robots, JSON.stringify(q)).toBeUndefined();
    }
    expect(ssr.calls).toBe(0);
  });

  it('con filtro, búsqueda, intención de sellado u orden distinto del de defecto ⇒ /catalog', async () => {
    for (const q of [
      { page: '2', q: 'pikachu' },
      { page: '2', setId: 'sv3pt5' },
      { page: '2', productType: 'graded' },
      { page: '2', type: 'graded' },
      { page: '2', finish: 'reverse_holo' },
      { page: '2', rarity: 'Rare' },
      { page: '2', condition: 'NM' },
      { page: '2', minPriceCents: '1000' },
      { page: '2', sort: 'price_asc' },
      { page: '2', productType: 'sealed' },
    ]) {
      const m = await meta('es', q);
      expect(m.alternates?.canonical, JSON.stringify(q)).toBe(`${SITE}/es/catalog`);
      expect((m.alternates?.languages as Record<string, string>).en, JSON.stringify(q)).toBe(`${SITE}/en/catalog`);
    }
  });

  it('el orden por defecto explícito y los parámetros ajenos (utm) no son filtros', async () => {
    expect((await meta('es', { page: '2', sort: 'newest' })).alternates?.canonical).toBe(`${SITE}/es/catalog?page=2`);
    expect((await meta('es', { page: '2', utm_source: 'ig' })).alternates?.canonical).toBe(`${SITE}/es/catalog?page=2`);
  });

  it('fuera de rango (catalog.pageOutOfRange) ⇒ noindex, follow y canonical /catalog', async () => {
    const m = await meta('es', { page: '99' });
    expect(m.alternates?.canonical).toBe(`${SITE}/es/catalog`);
    expect(m.robots).toEqual({ index: false, follow: true });
    // Con filtro también: la página no existe.
    expect((await meta('en', { page: '99', q: 'x' })).robots).toEqual({ index: false, follow: true });
  });

  it('sin lectura a tiempo (backend lento) ⇒ no se sabe si existe: canonical propio, sin noindex', async () => {
    ssr.page = null;
    const m = await meta('es', { page: '4' });
    expect(m.alternates?.canonical).toBe(`${SITE}/es/catalog?page=4`);
    expect(m.robots).toBeUndefined();
  });
});
