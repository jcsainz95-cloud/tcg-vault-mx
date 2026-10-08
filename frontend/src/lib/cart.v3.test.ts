import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCart, readBundleOfferSeen, markBundleOfferSeen } from './cart';

/**
 * AC-F1 (`API_CONTRACT §AC.14`, `DESIGN_SYSTEM §AC-UX.5`) — carrito v3:
 * `{ ids, accessories: {id, qty}[], deckPulls: {token, slug, withEnergyBundle}[] }`.
 * Migra v1 y v2 SIN perder nada (como v1→v2) y conserva la caducidad de 30 días.
 */
const KEY = 'tcg.cart';
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-07T12:00:00Z').getTime();

const raw = () => JSON.parse(window.localStorage.getItem(KEY)!);

describe('AC-F1 · carrito v3', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('migra v2 `{ids, updatedAt}` sin perder piezas ni refrescar la caducidad', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ ids: ['inv-1'], updatedAt: NOW - 3 * DAY_MS }));
    const { result } = renderHook(() => useCart());
    expect(result.current.ids).toEqual(['inv-1']);
    expect(result.current.accessories).toEqual([]);
    expect(result.current.deckPulls).toEqual([]);
    // Leer no reescribe: la caducidad de v2 se respeta tal cual.
    expect(raw().updatedAt).toBe(NOW - 3 * DAY_MS);
  });

  it('un v2 caducado (30 d + 1 ms) se vacía igual que hoy', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ ids: ['inv-1'], updatedAt: NOW - 30 * DAY_MS - 1 }));
    const { result } = renderHook(() => useCart());
    expect(result.current.ids).toEqual([]);
  });

  it('migra v1 (array plano) a v3', () => {
    window.localStorage.setItem(KEY, JSON.stringify(['inv-1', 'inv-2']));
    const { result } = renderHook(() => useCart());
    expect(result.current.ids).toEqual(['inv-1', 'inv-2']);
    expect(raw()).toEqual({ ids: ['inv-1', 'inv-2'], accessories: [], deckPulls: [], updatedAt: NOW });
  });

  it('addAccessory suma cantidades al mismo id; setAccessoryQty y removeAccessory', () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.addAccessory('acc-1', 1));
    act(() => result.current.addAccessory('acc-1', 2));
    act(() => result.current.addAccessory('acc-2', 1));
    expect(result.current.accessories).toEqual([
      { id: 'acc-1', qty: 3 },
      { id: 'acc-2', qty: 1 },
    ]);
    act(() => result.current.setAccessoryQty('acc-1', 1));
    expect(result.current.accessories[0]).toEqual({ id: 'acc-1', qty: 1 });
    act(() => result.current.removeAccessory('acc-2'));
    expect(result.current.accessories).toEqual([{ id: 'acc-1', qty: 1 }]);
    expect(raw().accessories).toEqual([{ id: 'acc-1', qty: 1 }]);
  });

  it('la cantidad se acota a 1..99 (tope del DTO §AC.4) y 0 quita el renglón', () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.addAccessory('acc-1', 150));
    expect(result.current.accessories).toEqual([{ id: 'acc-1', qty: 99 }]);
    act(() => result.current.setAccessoryQty('acc-1', 0));
    expect(result.current.accessories).toEqual([]);
  });

  it('deckPulls: upsert por slug; setBundle y removeDeckPull', () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.upsertDeckPull({ token: 't1', slug: 'dragapult-ex', withEnergyBundle: false, deckName: 'Dragapult ex' }));
    act(() => result.current.upsertDeckPull({ token: 't2', slug: 'dragapult-ex', withEnergyBundle: false }));
    expect(result.current.deckPulls).toEqual([
      { token: 't2', slug: 'dragapult-ex', withEnergyBundle: false, deckName: 'Dragapult ex' },
    ]);
    act(() => result.current.setBundle('dragapult-ex', true));
    expect(result.current.deckPulls[0].withEnergyBundle).toBe(true);
    act(() => result.current.removeDeckPull('dragapult-ex'));
    expect(result.current.deckPulls).toEqual([]);
  });

  it('isEmpty: sin piezas, sin accesorios y sin paquete; un deckPull sin paquete no cuenta', () => {
    const { result } = renderHook(() => useCart());
    expect(result.current.isEmpty).toBe(true);
    act(() => result.current.upsertDeckPull({ token: 't', slug: 's', withEnergyBundle: false }));
    expect(result.current.isEmpty).toBe(true);
    act(() => result.current.addAccessory('acc-1', 2));
    expect(result.current.isEmpty).toBe(false);
    // count = piezas + unidades de accesorio + paquetes (lo que el encabezado enseña).
    act(() => result.current.add('inv-1'));
    act(() => result.current.setBundle('s', true));
    expect(result.current.count).toBe(1 + 2 + 1);
  });

  it('clear vacía las tres partes', () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.add('inv-1'));
    act(() => result.current.addAccessory('acc-1', 1));
    act(() => result.current.upsertDeckPull({ token: 't', slug: 's', withEnergyBundle: true }));
    act(() => result.current.clear());
    expect(raw()).toEqual({ ids: [], accessories: [], deckPulls: [], updatedAt: NOW });
  });

  it('basura en storage se sanea (cantidades no enteras, ids no texto, pulls incompletos)', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        ids: ['inv-1', 7],
        accessories: [{ id: 'acc-1', qty: 2.5 }, { id: 3, qty: 1 }, { id: 'acc-2', qty: 2 }],
        deckPulls: [{ token: 't', slug: 's', withEnergyBundle: 'yes' }, { slug: 'x' }],
        updatedAt: NOW,
      }),
    );
    const { result } = renderHook(() => useCart());
    expect(result.current.ids).toEqual(['inv-1']);
    expect(result.current.accessories).toEqual([{ id: 'acc-2', qty: 2 }]);
    expect(result.current.deckPulls).toEqual([{ token: 't', slug: 's', withEnergyBundle: false }]);
  });

  it('«la oferta del paquete, una vez»: se guarda aparte del carrito (tcg.cart.bundleOfferSeen)', () => {
    expect(readBundleOfferSeen()).toEqual([]);
    markBundleOfferSeen('dragapult-ex');
    markBundleOfferSeen('dragapult-ex');
    expect(readBundleOfferSeen()).toEqual(['dragapult-ex']);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});
