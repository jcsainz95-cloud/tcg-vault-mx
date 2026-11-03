/**
 * IDS-F2 (API_CONTRACT §IDS.9, criterio 521) — filtros `language` / `stamped` ⇒ query del API (rama real) y
 * `noindex, follow`; la URL los lee y los escribe (lista cerrada; basura ignorada); sin filtro, nada viaja.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { config } from '@/lib/config';
import { getCatalog } from '@/lib/api';
import { parseUrlFilters, serializeCatalogFilters } from './catalog-url';
import { catalogSeoOf } from './catalog-seo';

describe('IDS-F2 · filtros de versión en la URL', () => {
  it('parse: `language` de la lista cerrada y `stamped=true`; otro valor se ignora', () => {
    expect(parseUrlFilters(new URLSearchParams('language=es&stamped=true'))).toEqual({ language: 'es', stamped: true });
    expect(parseUrlFilters(new URLSearchParams('language=ja&stamped=1'))).toEqual({});
  });
  it('serialize es la inversa', () => {
    const f = { language: 'en' as const, stamped: true as const };
    expect(parseUrlFilters(serializeCatalogFilters(f))).toEqual(f);
  });
  it('`language` o `stamped` ⇒ noindex, follow (canonical /catalog); sin ellos, indexable', () => {
    expect(catalogSeoOf(new URLSearchParams('language=es'), null)).toEqual({ path: '/catalog', noindex: true });
    expect(catalogSeoOf(new URLSearchParams('stamped=true'), null)).toEqual({ path: '/catalog', noindex: true });
    expect(catalogSeoOf(new URLSearchParams(''), null)).toEqual({ path: '/catalog', noindex: false });
  });
});

describe('IDS-F2 · rama REAL de getCatalog', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const original = config.useMocks;
  beforeEach(() => {
    config.useMocks = false;
    fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers(),
      json: async () => ({ data: [], page: 1, pageSize: 20, total: 0 }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    config.useMocks = original;
    vi.unstubAllGlobals();
  });

  it('`language=es&stamped=true` viajan al API', async () => {
    await getCatalog({ language: 'es', stamped: true });
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://x');
    expect(url.pathname).toMatch(/\/catalog\/cards$/);
    expect(url.searchParams.get('language')).toBe('es');
    expect(url.searchParams.get('stamped')).toBe('true');
  });
  it('sin filtro, ni `language` ni `stamped` en la query (cuerpo de hoy)', async () => {
    await getCatalog({});
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://x');
    expect(url.searchParams.has('language')).toBe(false);
    expect(url.searchParams.has('stamped')).toBe(false);
  });
});
