import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createLocalStore, useStoredValue } from './local-store';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-11T12:00:00Z').getTime();

interface Line {
  cardId: string;
  qty: number;
}

function makeStore(maxAgeDays = 30) {
  return createLocalStore<Line[]>({
    key: 'tcg.test.lines',
    field: 'lines',
    event: 'tcg.test.changed',
    maxAgeMs: maxAgeDays * DAY_MS,
    sanitize: (raw) =>
      Array.isArray(raw)
        ? raw.filter((x): x is Line => !!x && typeof x === 'object' && typeof (x as Line).cardId === 'string')
        : [],
    empty: () => [],
  });
}

function raw() {
  return JSON.parse(window.localStorage.getItem('tcg.test.lines')!);
}

/**
 * Helper compartido de carritos (ARCHITECTURE §4.47.6): las reglas de `lib/cart.ts` v1.21.3
 * (caducidad `>` estricta, migración suave, tolerancia a corrupción, evento propio), ahora
 * parametrizadas por clave/campo/TTL para que el carrito de venta use exactamente las mismas.
 */
describe('createLocalStore · caducidad, migración y reactividad', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('write persiste `{ [field], updatedAt }` y read lo devuelve saneado', () => {
    const store = makeStore();
    store.write([{ cardId: 'c1', qty: 2 }]);
    expect(raw()).toEqual({ lines: [{ cardId: 'c1', qty: 2 }], updatedAt: NOW });
    expect(store.read().value).toEqual([{ cardId: 'c1', qty: 2 }]);
  });

  it('caduca con `>` estricto: a los N días cumplidos vive, a N días + 1ms se vacía (y se re-persiste vacío)', () => {
    const store = makeStore(7);
    window.localStorage.setItem('tcg.test.lines', JSON.stringify({ lines: [{ cardId: 'c1', qty: 1 }], updatedAt: NOW - 7 * DAY_MS }));
    expect(store.read().value).toEqual([{ cardId: 'c1', qty: 1 }]);
    window.localStorage.setItem('tcg.test.lines', JSON.stringify({ lines: [{ cardId: 'c1', qty: 1 }], updatedAt: NOW - (7 * DAY_MS + 1) }));
    expect(store.read().value).toEqual([]);
    expect(raw().lines).toEqual([]);
  });

  it('F2-4: `expired` solo cuando se descartó un valor NO vacío caducado (lo que el carrito de venta avisa)', () => {
    const store = makeStore(7);
    // Vivo ⇒ expired:false.
    window.localStorage.setItem('tcg.test.lines', JSON.stringify({ lines: [{ cardId: 'c1', qty: 1 }], updatedAt: NOW - DAY_MS }));
    expect(store.read()).toEqual({ value: [{ cardId: 'c1', qty: 1 }], expired: false });
    // Caducado con contenido ⇒ expired:true UNA vez (ya se re-persistió vacío: la siguiente lectura no avisa).
    window.localStorage.setItem('tcg.test.lines', JSON.stringify({ lines: [{ cardId: 'c1', qty: 1 }], updatedAt: NOW - (7 * DAY_MS + 1) }));
    expect(store.read()).toEqual({ value: [], expired: true });
    expect(store.read()).toEqual({ value: [], expired: false });
    // Caducado pero vacío ⇒ no se perdió nada: expired:false.
    window.localStorage.setItem('tcg.test.lines', JSON.stringify({ lines: [], updatedAt: NOW - (7 * DAY_MS + 1) }));
    expect(store.read()).toEqual({ value: [], expired: false });
    // Sin registro / corrupto ⇒ expired:false.
    window.localStorage.removeItem('tcg.test.lines');
    expect(store.read()).toEqual({ value: [], expired: false });
    window.localStorage.setItem('tcg.test.lines', '{not json');
    expect(store.read().expired).toBe(false);
  });

  it('leer NO refresca el timestamp', () => {
    const store = makeStore();
    window.localStorage.setItem('tcg.test.lines', JSON.stringify({ lines: [], updatedAt: NOW - DAY_MS }));
    store.read();
    expect(raw().updatedAt).toBe(NOW - DAY_MS);
  });

  it('registro sin timestamp válido: se conserva y se re-timestamps (migración suave)', () => {
    const store = makeStore();
    window.localStorage.setItem('tcg.test.lines', JSON.stringify({ lines: [{ cardId: 'c1', qty: 1 }], updatedAt: 'x' }));
    expect(store.read().value).toEqual([{ cardId: 'c1', qty: 1 }]);
    expect(raw().updatedAt).toBe(NOW);
  });

  it('migrateLegacy reconoce un formato anterior y lo persiste en el nuevo', () => {
    const store = createLocalStore<string[]>({
      key: 'tcg.test.lines',
      field: 'ids',
      event: 'e',
      maxAgeMs: DAY_MS,
      sanitize: (r) => (Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : []),
      empty: () => [],
      migrateLegacy: (r) => (Array.isArray(r) ? (r as string[]) : undefined),
    });
    window.localStorage.setItem('tcg.test.lines', JSON.stringify(['a', 'b']));
    expect(store.read().value).toEqual(['a', 'b']);
    expect(raw()).toEqual({ ids: ['a', 'b'], updatedAt: NOW });
  });

  it('JSON corrupto o forma desconocida ⇒ vacío, sin lanzar', () => {
    const store = makeStore();
    window.localStorage.setItem('tcg.test.lines', '{not json');
    expect(store.read().value).toEqual([]);
    window.localStorage.setItem('tcg.test.lines', JSON.stringify({ other: 1 }));
    expect(store.read().value).toEqual([]);
  });

  it('sanea entradas basura dentro del array', () => {
    const store = makeStore();
    window.localStorage.setItem('tcg.test.lines', JSON.stringify({ lines: [{ cardId: 'ok', qty: 1 }, 42, null, { qty: 1 }], updatedAt: NOW }));
    expect(store.read().value).toEqual([{ cardId: 'ok', qty: 1 }]);
  });

  it('useStoredValue lee al montar y reacciona al evento propio y a `storage`', () => {
    const store = makeStore();
    store.persist([{ cardId: 'c0', qty: 1 }]);
    const { result } = renderHook(() => useStoredValue(store, () => []));
    expect(result.current).toEqual([{ cardId: 'c0', qty: 1 }]);
    act(() => store.write([{ cardId: 'c1', qty: 3 }]));
    expect(result.current).toEqual([{ cardId: 'c1', qty: 3 }]);
    act(() => {
      store.persist([{ cardId: 'c2', qty: 1 }]);
      window.dispatchEvent(new Event('storage'));
    });
    expect(result.current).toEqual([{ cardId: 'c2', qty: 1 }]);
    act(() => store.clear());
    expect(result.current).toEqual([]);
  });
});
