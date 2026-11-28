import { describe, it, expect, afterEach } from 'vitest';
import { getBuylistQuote, batchQuote } from './api';
import * as fx from './mock/fixtures';

/** §BUYLIST-ES F4 · servidor FALSO aditivo: ligas solo con el dial `leagueEnabled`; apagado = forma de siempre. */
const policy = fx.mockBuylistQuotePolicy;
afterEach(() => {
  policy.leagueEnabled = false;
  policy.spanishEnabled = false;
});

describe('mock buylist · liga (F4)', () => {
  it('dial apagado: sin `stampOptions`/`versions` y un productId de liga ⇒ 422 STAMP_NOT_AVAILABLE', async () => {
    const q = await getBuylistQuote({ cardId: 'c-pikachu-ir', productType: 'raw', finish: 'holofoil' });
    expect(q.stampOptions).toBeUndefined();
    expect(q.versions).toBeUndefined();
    const b = await batchQuote([{ cardId: 'c-pikachu-ir', productType: 'raw', finish: 'holofoil', productId: 648703 }]);
    expect(b.results[0]).toMatchObject({ ok: false, error: { code: 'STAMP_NOT_AVAILABLE' } });
  });

  it('dial encendido: versions[] idioma × (normal + liga) y la liga se cotiza con SU referencia', async () => {
    policy.leagueEnabled = true;
    policy.spanishEnabled = true;
    const q = await getBuylistQuote({ cardId: 'c-pikachu-ir', productType: 'raw', finish: 'holofoil' });
    expect(q.stampOptions).toEqual([{ productId: 648703, type: 'prize_pack', label: 'Prize Pack' }]);
    expect(q.versions?.map((v) => v.key)).toEqual(['en', 'es', 'en.648703', 'es.648703']);
    const stamped = await getBuylistQuote({ cardId: 'c-pikachu-ir', productType: 'raw', finish: 'holofoil', productId: 648703 });
    const en = q.versions!.find((v) => v.key === 'en.648703')!.offerCents;
    expect(stamped.productId).toBe(648703);
    expect(stamped.quote.quotedPriceCents).toBe(en);
    const stampedEs = await getBuylistQuote({ cardId: 'c-pikachu-ir', productType: 'raw', finish: 'holofoil', productId: 648703, language: 'es' });
    expect(stampedEs.quote.quotedPriceCents).toBe(q.versions!.find((v) => v.key === 'es.648703')!.offerCents);
    expect(stampedEs.quote.quotedPriceCents!).toBeLessThanOrEqual(en!);
  });
});
