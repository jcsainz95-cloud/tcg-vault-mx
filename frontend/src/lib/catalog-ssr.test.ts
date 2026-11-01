import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import {
  CATALOG_SSR_BUDGET_MS,
  CATALOG_SSR_REVALIDATE_S,
  DETAIL_SSR_BUDGET_MS,
  DETAIL_NOT_FOUND,
  loadCardDetailForSSR,
  loadCatalogPageForSSR,
  loadSealedDetailForSSR,
  responseAgeMs,
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
    await expect(loadCatalogPageForSSR({ setId: 'base1' }, 'newest')).resolves.toEqual({ data: page, ageMs: null });
    expect(getCatalog).toHaveBeenCalledWith(
      { setId: 'base1', sort: 'newest' },
      expect.objectContaining({ next: { revalidate: 30, tags: ['catalog'] } }),
    );
  });

  /**
   * B-R2 (QA sobre `e066b0b5`): la caché de datos de Next guarda las cabeceras con el cuerpo; una copia servida tras
   * vencer la ventana trae el `Date` de SU lectura. El loader devuelve esa edad (no la hora de servirla).
   * Mutación que lo pone rojo: devolver `ageMs: 0` (o medir con `Date.now()` al servir) ⇒ la copia de 65 s sale «fresca».
   */
  it('B-R2: devuelve la edad real del dato por la cabecera `Date` del backend (copia cacheada de 65 s ⇒ ~65 s)', async () => {
    const page = { data: [], page: 1, pageSize: 20, total: 0 };
    const readAt = new Date(Date.now() - 65_000).toUTCString();
    vi.spyOn(api, 'getCatalog').mockImplementation((async (_f: unknown, server?: api.ServerReadOptions) => {
      server?.onHeaders?.(new Headers({ date: readAt }));
      return page;
    }) as never);
    const got = await loadCatalogPageForSSR({}, 'newest');
    expect(got?.data).toBe(page);
    expect(got?.ageMs).toBeGreaterThanOrEqual(64_000);
    expect(got?.ageMs).toBeLessThan(67_000);
  });

  // ARCHITECTURE §4.DYN (f) 9 (v1.115, TL-MKT2-8): sin cabecera, ilegible o NEGATIVA ⇒ desconocida (= vieja). Antes una
  // hora futura daba 0 («recién leída»), es decir fresca.
  it('responseAgeMs: sin cabecera, ilegible o hora futura (edad negativa) ⇒ null', () => {
    expect(responseAgeMs(null, 1_000)).toBeNull();
    expect(responseAgeMs('banana', 1_000)).toBeNull();
    expect(responseAgeMs(new Date(5_000).toUTCString(), 1_000)).toBeNull();
    expect(responseAgeMs(new Date(1_000).toUTCString(), 1_000)).toBe(0);
    expect(responseAgeMs(new Date(0).toUTCString(), 31_000)).toBe(31_000);
  });

  /**
   * TL-MKT3-1 (y seguridad 10/10): con `withBudget` el tope dejaba de esperar pero el fetch seguía vivo (socket colgado
   * contra un backend congelado). Ahora el tope ABORTA la lectura del catálogo con la señal que recibe `getCatalog`.
   */
  it('TL-MKT3-1: backend que no responde ⇒ null al vencer el tope y la señal de `getCatalog` queda abortada', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      vi.spyOn(api, 'getCatalog').mockImplementation(((_f: unknown, server?: api.ServerReadOptions) => {
        signal = server?.signal;
        return new Promise<never>((_, reject) => {
          server?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }) as never);
      let settled: unknown = 'pendiente';
      const p = loadCatalogPageForSSR({}, 'newest').then((v) => (settled = v));
      await vi.advanceTimersByTimeAsync(CATALOG_SSR_BUDGET_MS - 1);
      expect(settled).toBe('pendiente');
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(settled).toBeNull();
      expect(signal, 'getCatalog recibe una señal').toBeDefined();
      expect(signal!.aborted, 'el tope aborta el fetch').toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

    it(`${name}: C3 · 404 del backend ⇒ DETAIL_NOT_FOUND (la página da 404); otro error ⇒ null (carga en cliente)`, async () => {
      vi.spyOn(api, fn).mockRejectedValueOnce(new ApiClientError(404, { code: 'NOT_FOUND', message: 'x' }) as never);
      await expect(load('id-404')).resolves.toBe(DETAIL_NOT_FOUND);
      vi.spyOn(api, fn).mockRejectedValueOnce(new ApiClientError(500, { code: 'INTERNAL', message: 'x' }) as never);
      await expect(load('id-500')).resolves.toBeNull();
    });
  }
});
