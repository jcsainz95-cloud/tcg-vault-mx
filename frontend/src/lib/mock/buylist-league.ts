/**
 * MOCK §BUYLIST-ES F4 (§3.4) · ligas del cotizador, servidor FALSO (solo `api.ts` lo importa, regla R1). Aproximación de demo
 * sobre la curva falsa; los montos reales los calcula `decideBuyLine` en el backend.
 */
import * as fx from './fixtures';
import type { BuylistQuoteResponse, CardLanguage } from '@/types/contract';

export const MOCK_LEAGUE: Record<string, { productId: number; type: string; label: string; refCents: number }> = {
  'c-pikachu-ir': { productId: 648703, type: 'prize_pack', label: 'Prize Pack', refCents: 48000 },
};
function mockLeagueOffers(refCents: number): { en: number | null; es: number | null } {
  const en = fx.mockDemoBuyQuote(refCents).cents;
  const pct = fx.mockBuylistQuotePolicy.spanishPenaltyPct ?? 15;
  const adjusted = refCents - Math.floor((refCents * pct + 50) / 100);
  const curveEs = fx.mockDemoBuyQuote(adjusted).cents;
  return { en, es: en == null || curveEs == null ? null : Math.min(curveEs, en) };
}
export function mockApplyLeague(
  base: BuylistQuoteResponse,
  cardId: string,
  language: CardLanguage | undefined,
  productId: number | undefined,
): BuylistQuoteResponse {
  const lg = MOCK_LEAGUE[cardId];
  if (!fx.mockBuylistQuotePolicy.leagueEnabled || !lg) return base;
  const spanishOn = fx.mockBuylistQuotePolicy.spanishEnabled === true;
  const stamp = { productId: lg.productId, type: lg.type, label: lg.label };
  const normal = base.offers ?? { en: base.quote.quotedPriceCents, es: null };
  const league = mockLeagueOffers(lg.refCents);
  const row = (language: CardLanguage, st: typeof stamp | null, offerCents: number | null) => ({
    key: st ? `${language}.${st.productId}` : language,
    language,
    stamp: st,
    offerCents,
    reason: offerCents == null ? ('no_reference' as const) : null,
  });
  const versions = [
    row('en', null, normal.en),
    ...(spanishOn ? [row('es', null, normal.es)] : []),
    row('en', stamp, league.en),
    ...(spanishOn ? [row('es', stamp, league.es)] : []),
  ];
  const withVersions = { ...base, stampOptions: [stamp], versions };
  if (productId !== lg.productId) return withVersions;
  const lang = language === 'es' && spanishOn ? 'es' : 'en';
  const cents = lang === 'es' ? league.es : league.en;
  return {
    ...withVersions,
    productId: lg.productId,
    language: lang,
    offers: spanishOn ? league : { en: league.en, es: null },
    referencePrice: { status: 'priced', priceMxnCents: lg.refCents },
    quote: { ...base.quote, quotedPriceCents: cents },
    breakdown: undefined,
  };
}

