import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCart } from './cart';

const KEY = 'tcg.cart';
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-18T12:00:00Z').getTime();

function rawRecord(): { ids: string[]; updatedAt: number } {
  return JSON.parse(window.localStorage.getItem(KEY)!);
}

function seedV2(ids: string[], updatedAt: number) {
  window.localStorage.setItem(KEY, JSON.stringify({ ids, updatedAt }));
}

/**
 * Expiración a 30 días + migración suave del formato legado (v1.21.3-quote-prune,
 * nota de frontend del contrato §4) + poda en lote (`prune`).
 */
describe('useCart · timestamp, expiración a 30 días y prune', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('migra el formato legado (array plano) SIN perder el carrito y persiste el formato nuevo', () => {
    window.localStorage.setItem(KEY, JSON.stringify(['inv-1', 'inv-2']));
    const { result } = renderHook(() => useCart());

    expect(result.current.ids).toEqual(['inv-1', 'inv-2']);
    // La lectura ya migró el storage a { ids, updatedAt }.
    expect(rawRecord()).toEqual({ ids: ['inv-1', 'inv-2'], updatedAt: NOW });
  });

  it('un carrito modificado hace MÁS de 30 días se limpia al cargar', () => {
    seedV2(['inv-1'], NOW - (30 * DAY_MS + 1));
    const { result } = renderHook(() => useCart());

    expect(result.current.ids).toEqual([]);
    expect(rawRecord().ids).toEqual([]);
  });

  it('un carrito de 30 días EXACTOS se conserva (expira con > estricto, no con ≥)', () => {
    seedV2(['inv-1'], NOW - 30 * DAY_MS);
    const { result } = renderHook(() => useCart());

    expect(result.current.ids).toEqual(['inv-1']);
  });

  it('un carrito reciente (≤30 días) se conserva tal cual', () => {
    seedV2(['inv-1', 'inv-2'], NOW - 29 * DAY_MS);
    const { result } = renderHook(() => useCart());

    expect(result.current.ids).toEqual(['inv-1', 'inv-2']);
    // Leer NO refresca el timestamp (solo add/remove/prune/clear modifican).
    expect(rawRecord().updatedAt).toBe(NOW - 29 * DAY_MS);
  });

  it('add/remove/clear refrescan el timestamp de última modificación', () => {
    seedV2(['inv-1'], NOW - 5 * DAY_MS);
    const { result } = renderHook(() => useCart());

    act(() => result.current.add('inv-2'));
    expect(rawRecord()).toEqual({ ids: ['inv-1', 'inv-2'], updatedAt: NOW });

    vi.setSystemTime(NOW + 1000);
    act(() => result.current.remove('inv-1'));
    expect(rawRecord()).toEqual({ ids: ['inv-2'], updatedAt: NOW + 1000 });

    vi.setSystemTime(NOW + 2000);
    act(() => result.current.clear());
    expect(rawRecord()).toEqual({ ids: [], updatedAt: NOW + 2000 });
  });

  it('prune(ids) poda varios de una vez con la misma semántica de storage que remove', () => {
    seedV2(['inv-1', 'inv-2', 'inv-3'], NOW - DAY_MS);
    const { result } = renderHook(() => useCart());

    act(() => result.current.prune(['inv-1', 'inv-3', 'inv-fantasma']));
    expect(result.current.ids).toEqual(['inv-2']);
    expect(rawRecord()).toEqual({ ids: ['inv-2'], updatedAt: NOW });
  });

  it('prune es idempotente: si ningún id sigue en el carrito no escribe (no cicla efectos)', () => {
    seedV2(['inv-1'], NOW - DAY_MS);
    const { result } = renderHook(() => useCart());

    act(() => result.current.prune(['inv-x', 'inv-y']));
    expect(result.current.ids).toEqual(['inv-1']);
    // El timestamp NO se tocó: no hubo write.
    expect(rawRecord().updatedAt).toBe(NOW - DAY_MS);
  });

  it('un registro v2 sin timestamp válido se trata como legado: se conserva y se re-timestamps', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ ids: ['inv-1'] }));
    const { result } = renderHook(() => useCart());

    expect(result.current.ids).toEqual(['inv-1']);
    expect(rawRecord()).toEqual({ ids: ['inv-1'], updatedAt: NOW });
  });
});
