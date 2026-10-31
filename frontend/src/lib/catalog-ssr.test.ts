import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from '@/lib/api';
import {
  CATALOG_SSR_BUDGET_MS,
  CATALOG_SSR_REVALIDATE_S,
  DETAIL_SSR_BUDGET_MS,
  loadCardDetailForSSR,
  loadCatalogPageForSSR,
  loadSealedDetailForSSR,
} from '@/lib/catalog-ssr';
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

/**
 * I-1 de QA sobre `561ad425` (TL-MKT2-1): con el backend congelado (`kill -STOP`) `/es/catalog/<id>` y
 * `/es/sellado/<id>` no respondían en 30 s porque las lecturas de ficha esperaban sin tope. Ahora tienen un tope
 * nombrado (el mismo criterio que el catálogo) y, al vencer, ABORTAN el fetch y devuelven `null` ⇒ la ficha sale con
 * su carga en cliente.
 */
describe('I-1 · las lecturas SSR de ficha tienen tope y abortan', () => {
  /** Lectura que nunca responde salvo que la aborten; guarda la señal que recibió. */
  function hanging() {
    const seen: { signal?: AbortSignal } = {};
    const impl = (_id: string, server?: { signal?: AbortSignal }) => {
      seen.signal = server?.signal;
      return new Promise<never>((_, reject) => {
        server?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    };
    return { seen, impl };
  }

  it('el tope de ficha es el del catálogo', () => {
    expect(DETAIL_SSR_BUDGET_MS).toBe(CATALOG_SSR_BUDGET_MS);
  });

  for (const [name, fn, load] of [
    ['carta', 'getCardDetail', loadCardDetailForSSR],
    ['sellado', 'getSealedGroupDetail', loadSealedDetailForSSR],
  ] as const) {
    it(`${name}: backend que no responde ⇒ null al vencer el tope, y el fetch queda abortado`, async () => {
      vi.useFakeTimers();
      try {
        const { seen, impl } = hanging();
        vi.spyOn(api, fn).mockImplementation(impl as never);
        let settled: unknown = 'pendiente';
        const p = load('id-x').then((v) => (settled = v));
        await vi.advanceTimersByTimeAsync(DETAIL_SSR_BUDGET_MS - 1);
        expect(settled).toBe('pendiente');
        await vi.advanceTimersByTimeAsync(1);
        await p;
        expect(settled).toBeNull();
        expect(seen.signal, 'la lectura recibe una señal').toBeDefined();
        expect(seen.signal!.aborted, 'el tope aborta el fetch').toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it(`${name}: a tiempo devuelve el dato y no aborta`, async () => {
      const data = { ok: name };
      let signal: AbortSignal | undefined;
      vi.spyOn(api, fn).mockImplementation(((_id: string, server?: { signal?: AbortSignal }) => {
        signal = server?.signal;
        return Promise.resolve(data);
      }) as never);
      await expect(load('id-y')).resolves.toBe(data);
      expect(signal?.aborted).toBe(false);
    });
  }
});
