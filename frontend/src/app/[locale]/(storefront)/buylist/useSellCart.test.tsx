import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import * as api from '@/lib/api';
import type { BuylistQuoteItemDTO, BuylistQuoteResponse } from '@/types/contract';
import { useSellCart, SELL_CART_KEY, SELL_CART_MAX_AGE_MS, type NewCartLine } from './useSellCart';

const quote = (cents: number | null): BuylistQuoteResponse => ({
  rarity: 'Rare Holo',
  finish: 'normal',
  priceBasis: cents == null ? 'pending' : 'market',
  quote: {
    status: cents == null ? 'precio_pendiente' : 'cotizada',
    quotedPriceCents: cents,
    currency: 'MXN',
  },
  referencePrice: cents == null ? { status: 'pending' } : { status: 'priced', priceMxnCents: cents * 2 },
  paymentNotice: 'PAY_AFTER_RECEIPT',
});

const line = (id: string, name: string, cents: number | null): NewCartLine => ({
  card: { id, name, number: '1' },
  productType: 'raw',
  rawCondition: 'NM',
  finish: 'normal',
  quote: quote(cents),
});

/** Servidor de batch: precio por cardId; `null` = precio pendiente; ausente = ok:false (NOT_FOUND). */
function batchServer(prices: Record<string, number | null>) {
  return vi.spyOn(api, 'batchQuote').mockImplementation(async (items: BuylistQuoteItemDTO[]) => ({
    results: items.map((it, index) =>
      it.cardId in prices
        ? {
            index,
            cardId: it.cardId,
            ok: true as const,
            rarity: 'Rare Holo',
            finish: it.finish ?? ('normal' as const),
            priceBasis: prices[it.cardId] == null ? ('pending' as const) : ('market' as const),
            quote: {
              status: prices[it.cardId] == null ? ('precio_pendiente' as const) : ('cotizada' as const),
              quotedPriceCents: prices[it.cardId],
              currency: 'MXN' as const,
            },
            referencePrice: { status: 'priced' as const, priceMxnCents: 1 },
            paymentNotice: 'PAY_AFTER_RECEIPT' as const,
          }
        : {
            index,
            cardId: it.cardId,
            ok: false as const,
            error: { code: 'NOT_FOUND' as const, message: 'Card not found' },
          },
    ),
  }));
}

function stored() {
  return JSON.parse(window.localStorage.getItem(SELL_CART_KEY) ?? 'null') as {
    lines: unknown[];
    updatedAt: number;
  } | null;
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/**
 * §33.11 / ARCHITECTURE §4.47.6 (P-55): el carrito de venta PERSISTE en `tcg.sellCart` y, al
 * rehidratar, SE RE-COTIZA antes de poder enviar: el precio persistido es pintura, no autoridad.
 */
describe('useSellCart · persistencia (P-55)', () => {
  it('escribe en localStorage en cada cambio y borra la clave al vaciar', async () => {
    const { result } = renderHook(() => useSellCart());
    await waitFor(() => expect(result.current.requoteStatus).toBe('idle'));

    act(() => result.current.addLine(line('c-1', 'Charizard', 100000)));
    expect(stored()!.lines).toHaveLength(1);
    act(() => result.current.setQuantity(result.current.cart[0].id, 3));
    expect((stored()!.lines[0] as { quantity: number }).quantity).toBe(3);

    act(() => result.current.clearCart());
    expect(stored()!.lines).toEqual([]);
    expect(result.current.cart).toEqual([]);
  });

  it('al montar con lista guardada la restaura, la RE-COTIZA (batch) y sustituye los precios; hasta entonces `requoting`', async () => {
    window.localStorage.setItem(
      SELL_CART_KEY,
      JSON.stringify({
        lines: [{ id: 'line-7', ...line('c-1', 'Charizard', 100000), quantity: 2 }],
        updatedAt: Date.now() - 1000,
      }),
    );
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const batch = batchServer({ 'c-1': 120000 });
    batch.mockImplementationOnce(async (items) => {
      await gate;
      return batchServer({ 'c-1': 120000 }).getMockImplementation()!(items);
    });

    const { result } = renderHook(() => useSellCart());
    await waitFor(() => expect(result.current.cart).toHaveLength(1));
    expect(result.current.requoting).toBe(true);
    expect(result.current.restore).toMatchObject({ kind: 'restored', count: 2 });
    expect(batch).toHaveBeenCalledWith([{ cardId: 'c-1', productType: 'raw', rawCondition: 'NM', finish: 'normal' }]);

    release();
    await waitFor(() => expect(result.current.requoteStatus).toBe('done'));
    // El precio que manda es el NUEVO (120000 × 2), no el persistido (100000 × 2).
    expect(result.current.cart[0].quote.quote.quotedPriceCents).toBe(120000);
    expect(result.current.totalEstimatedCents).toBe(240000);
    expect(result.current.restore).toEqual({
      kind: 'restored',
      count: 2,
      repriced: { beforeCents: 200000, afterCents: 240000 },
      droppedCount: 0,
    });
    // Y lo persistido ya es el precio de hoy.
    expect((stored()!.lines[0] as { quote: BuylistQuoteResponse }).quote.quote.quotedPriceCents).toBe(120000);
  });

  it('una línea `ok:false` se PODA y se cuenta; una `precio_pendiente` se conserva; sin cambio de precio no hay «repriced»', async () => {
    window.localStorage.setItem(
      SELL_CART_KEY,
      JSON.stringify({
        lines: [
          { id: 'line-1', ...line('c-1', 'Charizard', 100000), quantity: 1 },
          { id: 'line-2', ...line('c-gone', 'Missingno', 5000), quantity: 3 },
          { id: 'line-3', ...line('c-pend', 'Zapdos', null), quantity: 1 },
        ],
        updatedAt: Date.now() - 1000,
      }),
    );
    batchServer({ 'c-1': 100000, 'c-pend': null });
    const { result } = renderHook(() => useSellCart());
    await waitFor(() => expect(result.current.requoteStatus).toBe('done'));

    expect(result.current.cart.map((l) => l.card.id)).toEqual(['c-1', 'c-pend']);
    expect(result.current.restore).toEqual({ kind: 'restored', count: 5, repriced: null, droppedCount: 3 });
    expect(result.current.pendingCardCount).toBe(1);
    expect(stored()!.lines).toHaveLength(2);
  });

  it('más de 50 líneas ⇒ varios lotes de ≤50 (cap del contrato) y todas recotizadas', async () => {
    const lines = Array.from({ length: 73 }, (_, i) => ({
      id: `line-${i + 1}`,
      ...line(`c-${i}`, `Card ${i}`, 1000),
      quantity: 1,
    }));
    window.localStorage.setItem(SELL_CART_KEY, JSON.stringify({ lines, updatedAt: Date.now() }));
    const prices = Object.fromEntries(lines.map((_, i) => [`c-${i}`, 2000]));
    const batch = batchServer(prices);
    const { result } = renderHook(() => useSellCart());
    await waitFor(() => expect(result.current.requoteStatus).toBe('done'));

    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch.mock.calls[0][0]).toHaveLength(50);
    expect(batch.mock.calls[1][0]).toHaveLength(23);
    expect(result.current.cart).toHaveLength(73);
    expect(result.current.cart.every((l) => l.quote.quote.quotedPriceCents === 2000)).toBe(true);
  });

  it('caducada (> 30 días): se descarta, `restore.kind = expired`, sin recotizar', async () => {
    window.localStorage.setItem(
      SELL_CART_KEY,
      JSON.stringify({
        lines: [{ id: 'line-1', ...line('c-1', 'Charizard', 100000), quantity: 1 }],
        updatedAt: Date.now() - SELL_CART_MAX_AGE_MS - 1,
      }),
    );
    const batch = vi.spyOn(api, 'batchQuote');
    const { result } = renderHook(() => useSellCart());
    await waitFor(() => expect(result.current.restore).toEqual({ kind: 'expired' }));
    expect(result.current.cart).toEqual([]);
    expect(batch).not.toHaveBeenCalled();
    expect(stored()!.lines).toEqual([]);
  });

  it('a los 30 días EXACTOS sigue viva (`>` estricto)', async () => {
    window.localStorage.setItem(
      SELL_CART_KEY,
      JSON.stringify({
        lines: [{ id: 'line-1', ...line('c-1', 'Charizard', 100000), quantity: 1 }],
        updatedAt: Date.now() - SELL_CART_MAX_AGE_MS + 50,
      }),
    );
    batchServer({ 'c-1': 100000 });
    const { result } = renderHook(() => useSellCart());
    await waitFor(() => expect(result.current.requoteStatus).toBe('done'));
    expect(result.current.cart).toHaveLength(1);
  });

  it('si el batch falla entero: la lista se conserva con los estimados guardados, `requoteFailed` y «Reintentar» recotiza', async () => {
    window.localStorage.setItem(
      SELL_CART_KEY,
      JSON.stringify({
        lines: [{ id: 'line-1', ...line('c-1', 'Charizard', 100000), quantity: 1 }],
        updatedAt: Date.now(),
      }),
    );
    const batch = vi.spyOn(api, 'batchQuote').mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useSellCart());
    await waitFor(() => expect(result.current.requoteStatus).toBe('failed'));
    expect(result.current.requoteFailed).toBe(true);
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0].quote.quote.quotedPriceCents).toBe(100000);

    batch.mockRestore();
    batchServer({ 'c-1': 90000 });
    act(() => result.current.retryRequote());
    await waitFor(() => expect(result.current.requoteStatus).toBe('done'));
    expect(result.current.cart[0].quote.quote.quotedPriceCents).toBe(90000);
  });

  it('formato desconocido o corrupto NO revienta: carrito vacío, sin aviso de caducidad', async () => {
    window.localStorage.setItem(SELL_CART_KEY, '{not json');
    const { result } = renderHook(() => useSellCart());
    await waitFor(() => expect(result.current.requoteStatus).toBe('idle'));
    expect(result.current.cart).toEqual([]);
    expect(result.current.restore).toEqual({ kind: 'none' });
  });

  it('los ids nuevos no colisionan con los restaurados', async () => {
    window.localStorage.setItem(
      SELL_CART_KEY,
      JSON.stringify({
        lines: [{ id: 'line-9', ...line('c-1', 'Charizard', 100000), quantity: 1 }],
        updatedAt: Date.now(),
      }),
    );
    batchServer({ 'c-1': 100000, 'c-2': 5000 });
    const { result } = renderHook(() => useSellCart());
    await waitFor(() => expect(result.current.requoteStatus).toBe('done'));
    act(() => result.current.addLine(line('c-2', 'Pikachu', 5000)));
    const ids = result.current.cart.map((l) => l.id);
    expect(new Set(ids).size).toBe(2);
  });
});
