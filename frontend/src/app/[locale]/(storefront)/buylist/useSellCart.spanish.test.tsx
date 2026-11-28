import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSellCart, type NewCartLine } from './useSellCart';

/** §BUYLIST-ES F2 · el cambio de idioma NO pide red, cambia el monto y respeta la llave de línea. */
function nl(id: string, eligible = true): NewCartLine {
  return {
    card: { id, name: id, number: '1' },
    productType: 'raw',
    finish: 'normal',
    quote: {
      rarity: 'Rare',
      finish: 'normal',
      priceBasis: 'market',
      quote: { status: 'cotizada', quotedPriceCents: 50000, currency: 'MXN' },
      referencePrice: { status: 'priced', priceMxnCents: 100000 },
      paymentNotice: 'PAY_AFTER_RECEIPT',
      spanishEligible: eligible,
      offers: { en: 50000, es: eligible ? 42500 : null },
    },
  };
}

describe('useSellCart · idioma', () => {
  beforeEach(() => localStorage.clear());

  it('setLineLanguage cambia el monto sin llamada y viaja language:es en el envío', () => {
    const { result } = renderHook(() => useSellCart());
    act(() => result.current.addLine(nl('a')));
    const id = result.current.cart[0].id;
    act(() => result.current.setLineLanguage(id, 'es'));
    expect(result.current.cart[0].language).toBe('es');
    expect(result.current.cart[0].quote.quote.quotedPriceCents).toBe(42500);
    expect(result.current.totalEstimatedCents).toBe(42500);
    expect(result.current.requestItems[0].language).toBe('es');
    act(() => result.current.setLineLanguage(id, 'en'));
    expect(result.current.cart[0].language).toBeUndefined();
    expect(result.current.totalEstimatedCents).toBe(50000);
    expect(result.current.requestItems[0]).not.toHaveProperty('language');
  });

  it('EN y ES de la misma carta son 2 líneas; al igualar idioma se funden', () => {
    const { result } = renderHook(() => useSellCart());
    act(() => {
      result.current.addLine(nl('a'));
    });
    act(() => {
      result.current.addLine(nl('a'));
    });
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0].quantity).toBe(2);
  });

  it('«Todas en español» pasa las elegibles y cuenta las omitidas', () => {
    const { result } = renderHook(() => useSellCart());
    act(() => {
      result.current.addLine(nl('a'));
      result.current.addLine(nl('b', false));
    });
    let res = { switched: 0, skipped: 0 };
    act(() => {
      res = result.current.setAllSpanish();
    });
    expect(res).toEqual({ switched: 1, skipped: 1 });
    expect(result.current.cart.find((l) => l.card.id === 'a')?.language).toBe('es');
    expect(result.current.cart.find((l) => l.card.id === 'b')?.language).toBeUndefined();
  });
});
