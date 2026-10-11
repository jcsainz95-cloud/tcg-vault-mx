import { describe, it, expect } from 'vitest';
import { visibleMarketCents } from './sell-market';

/**
 * §BMK.3 (API_CONTRACT, NORMATIVA) — el predicado único del cliente:
 * se ve «Valor de mercado» ⇔ `referencePrice.status === "priced"` ∧ `quote.status === "cotizada"`
 * ∧ `priceMxnCents` entero > 0. Si no, `null` (el par NO existe en el DOM).
 */
const q = (
  quoteStatus: 'cotizada' | 'precio_pendiente',
  referencePrice: { status: 'priced' | 'pending'; priceMxnCents?: number },
) => ({ quote: { status: quoteStatus }, referencePrice });

describe('visibleMarketCents (§BMK.3)', () => {
  it('cotizada + priced > 0 ⇒ el mercado', () => {
    expect(visibleMarketCents(q('cotizada', { status: 'priced', priceMxnCents: 100_000 }))).toBe(100_000);
  });

  it('BMK-F2: precio_pendiente con referencePrice priced (servidor viejo) ⇒ null', () => {
    expect(visibleMarketCents(q('precio_pendiente', { status: 'priced', priceMxnCents: 100_000 }))).toBeNull();
  });

  it('BMK-F3: cotizada con referencePrice pending ⇒ null', () => {
    expect(visibleMarketCents(q('cotizada', { status: 'pending' }))).toBeNull();
  });

  it('BMK-F3: cotizada con priced 0 ⇒ null (nunca «MX$0.00»)', () => {
    expect(visibleMarketCents(q('cotizada', { status: 'priced', priceMxnCents: 0 }))).toBeNull();
  });

  it('negativo, no entero, NaN o ausente ⇒ null', () => {
    expect(visibleMarketCents(q('cotizada', { status: 'priced', priceMxnCents: -5 }))).toBeNull();
    expect(visibleMarketCents(q('cotizada', { status: 'priced', priceMxnCents: 10.5 }))).toBeNull();
    expect(visibleMarketCents(q('cotizada', { status: 'priced', priceMxnCents: Number.NaN }))).toBeNull();
    expect(visibleMarketCents(q('cotizada', { status: 'priced' }))).toBeNull();
  });

  it('entrada nula o incompleta ⇒ null (teja sin cotización)', () => {
    expect(visibleMarketCents(null)).toBeNull();
    expect(visibleMarketCents(undefined)).toBeNull();
  });

  it('no depende de priceBasis (bounty, override y floor se ven igual)', () => {
    for (const priceBasis of ['bounty', 'override', 'floor', 'market'] as const) {
      const withBasis = { ...q('cotizada', { status: 'priced', priceMxnCents: 5_000 }), priceBasis };
      expect(visibleMarketCents(withBasis)).toBe(5_000);
    }
  });
});
