import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { config } from './config';
import {
  getCardDetail,
  getCatalog,
  getFeatured,
  getPublicShippingRuleForServer,
  getSealedGroupDetail,
  type ServerReadOptions,
} from './api';

/**
 * TL-MKT3-1 (techlead sobre `e066b0b5`): `ServerReadOptions` se tomaba por partes — la ficha ignoraba `next`; catálogo,
 * portada y regla de envío ignoraban `signal`. Ahora las cinco lecturas de servidor pasan las opciones ENTERAS a `fetch`
 * (`next`, `signal`) y entregan las cabeceras de la respuesta a `onHeaders` (B-R2: el `Date` de la copia cacheada).
 * Rama REAL (`config.useMocks = false`), `fetch` simulado.
 *
 * Mutación que lo pone rojo: volver a `{ next: server?.next }` (o `{ signal: server?.signal }`) en cualquiera de ellas.
 */
const ok = (headers: Record<string, string> = {}) =>
  ({ status: 200, ok: true, headers: new Headers(headers), json: async () => ({}) }) as unknown as Response;

const READS: [string, (s: ServerReadOptions) => Promise<unknown>][] = [
  ['getCatalog', (s) => getCatalog({}, s)],
  ['getFeatured', (s) => getFeatured(s)],
  ['getCardDetail', (s) => getCardDetail('c1', s)],
  ['getSealedGroupDetail', (s) => getSealedGroupDetail('i1', s)],
  ['getPublicShippingRuleForServer', (s) => getPublicShippingRuleForServer(s)],
];

describe('TL-MKT3-1 · las lecturas de servidor pasan sus opciones enteras', () => {
  const original = config.useMocks;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    config.useMocks = false;
    fetchMock = vi.fn().mockResolvedValue(ok({ date: 'Sat, 31 Oct 2026 12:00:00 GMT' }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    config.useMocks = original;
    vi.unstubAllGlobals();
  });

  for (const [name, read] of READS) {
    it(`${name}: next + signal llegan a fetch y onHeaders recibe las cabeceras`, async () => {
      const ctrl = new AbortController();
      const onHeaders = vi.fn();
      const next = { revalidate: 30, tags: ['t'] };
      await read({ next, signal: ctrl.signal, onHeaders });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { next?: unknown }];
      expect(init.next).toEqual(next);
      expect(init.signal).toBe(ctrl.signal);
      expect(onHeaders).toHaveBeenCalledTimes(1);
      expect((onHeaders.mock.calls[0][0] as Headers).get('date')).toBe('Sat, 31 Oct 2026 12:00:00 GMT');
    });
  }

  it('sin opciones de servidor no se inventa nada', async () => {
    await getCatalog({});
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { next?: unknown }];
    expect(init.next).toBeUndefined();
    expect(init.signal).toBeUndefined();
  });
});
