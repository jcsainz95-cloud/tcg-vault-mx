import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from '@/lib/api';
import { CATALOG_SSR_REVALIDATE_S, loadCatalogPageForSSR } from '@/lib/catalog-ssr';
import { HOME_SSR_REVALIDATE_S } from '@/lib/home-queries';

// `cache()` de React solo existe en el build de servidor (RSC); en jsdom se sustituye por la identidad.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <F,>(fn: F) => fn,
}));

/**
 * R2 del techlead sobre `561ad425`: ARCHITECTURE §4.DYN (f) 3 fija «≤ 60 s en listas públicas, exacto al pagar». La
 * lectura SSR del catálogo usaba `no-store` (una petición al API por cada visita); ahora usa la caché de datos de
 * Next con la misma revalidación que la portada (30 s) y su etiqueta `catalog`.
 */
beforeEach(() => vi.restoreAllMocks());

describe('R2 · frescura de la lectura SSR del catálogo', () => {
  it('pide con revalidate 30 s y etiqueta `catalog`, con el orden por defecto si la URL no trae uno', async () => {
    const page = { data: [], page: 1, pageSize: 20, total: 0 };
    const getCatalog = vi.spyOn(api, 'getCatalog').mockResolvedValue(page);
    await expect(loadCatalogPageForSSR({ setId: 'base1' }, 'newest')).resolves.toEqual(page);
    expect(getCatalog).toHaveBeenCalledWith(
      { setId: 'base1', sort: 'newest' },
      { next: { revalidate: 30, tags: ['catalog'] } },
    );
  });

  it('la ventana es la de la portada y cabe en los 60 s de §4.DYN (f) 3', () => {
    expect(CATALOG_SSR_REVALIDATE_S).toBe(HOME_SSR_REVALIDATE_S);
    expect(CATALOG_SSR_REVALIDATE_S).toBeLessThanOrEqual(60);
  });

  it('sigue sin lanzar: un fallo del API es `null`', async () => {
    vi.spyOn(api, 'getCatalog').mockRejectedValue(new Error('boom'));
    await expect(loadCatalogPageForSSR({}, 'newest')).resolves.toBeNull();
  });
});
