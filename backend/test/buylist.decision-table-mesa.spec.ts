import { mesaFields, mxn } from '../src/modules/buylist/decision-table-mesa';
import { quoteAcquisitionWithGuard } from '../src/common/money';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/** BUYLIST-MESA — campos aditivos por línea (docs/API_CONTRACT_BUYLIST_MESA.md). */
const base = {
  marketMxnCents: 10000,
  curveQuoteCents: 4000,
  derivedPriceCents: 4000,
  priceBasis: 'market' as const,
  quotedPriceCents: 4000,
  quotedMarketMxnCents: 10000,
};

describe('mesaFields', () => {
  it('estándar: % efectivo en bp enteros, sin ajuste ni nota', () => {
    const r = mesaFields(base);
    expect(r).toEqual({
      marketMxnCents: 10000,
      standardOfferCents: 4000,
      standardPctBp: 4000,
      adjustment: null,
      sinceQuote: null,
    });
  });

  it('redondeo entero del % (round, jamás fracciones)', () => {
    const r = mesaFields({ ...base, marketMxnCents: 17177, curveQuoteCents: 6871, derivedPriceCents: 6871, quotedPriceCents: 6871 });
    expect(Number.isInteger(r.standardPctBp)).toBe(true);
    expect(r.standardPctBp).toBe(Math.round((6871 * 10000) / 17177));
  });

  it('override del staff por debajo: MANUAL_OVERRIDE con delta firmado negativo', () => {
    const r = mesaFields({ ...base, derivedPriceCents: 3000, priceBasis: 'override', quotedPriceCents: 3000 });
    expect(r.adjustment).toMatchObject({ deltaCents: -1000, reasonCode: 'MANUAL_OVERRIDE' });
    expect(r.adjustment!.reasonText.length).toBeGreaterThan(5);
  });

  it('bounty por encima: BOUNTY con delta positivo', () => {
    const r = mesaFields({ ...base, derivedPriceCents: 5000, priceBasis: 'bounty', quotedPriceCents: 5000 });
    expect(r.adjustment).toMatchObject({ deltaCents: 1000, reasonCode: 'BOUNTY' });
  });

  it('override == estándar ⇒ adjustment null (null ⇔ oferta == estándar)', () => {
    expect(mesaFields({ ...base, priceBasis: 'override' }).adjustment).toBeNull();
  });

  it('sin mercado: null, NUNCA 0; sin estándar', () => {
    const r = mesaFields({ ...base, marketMxnCents: null, curveQuoteCents: null, derivedPriceCents: null, priceBasis: 'pending' });
    expect(r.marketMxnCents).toBeNull();
    expect(r.standardOfferCents).toBeNull();
    expect(r.standardPctBp).toBeNull();
    expect(r.adjustment).toBeNull();
    const cero = mesaFields({ ...base, marketMxnCents: 0, curveQuoteCents: 0 });
    expect(cero.marketMxnCents).toBeNull();
    expect(cero.standardOfferCents).toBeNull();
  });

  it('override sin mercado: el ajuste existe (no se pinta «Estándar»)', () => {
    const r = mesaFields({ ...base, marketMxnCents: null, curveQuoteCents: null, derivedPriceCents: 2500, priceBasis: 'override' });
    expect(r.standardOfferCents).toBeNull();
    expect(r.adjustment).toMatchObject({ deltaCents: 2500, reasonCode: 'MANUAL_OVERRIDE' });
  });

  it('sinceQuote: mercado subió ⇒ MARKET_UP con texto del contrato', () => {
    const r = mesaFields({
      ...base, marketMxnCents: 17177, curveQuoteCents: 17177, derivedPriceCents: 17177,
      quotedPriceCents: 17084, quotedMarketMxnCents: 17084,
    });
    expect(r.sinceQuote).toEqual({
      quotedCents: 17084, deltaCents: 93, reasonCode: 'MARKET_UP',
      reasonText: 'el mercado subió de MX$170.84 a MX$171.77 desde que se cotizó',
    });
  });

  it('sinceQuote: bajó ⇒ MARKET_DOWN; mismo mercado ⇒ CURVE_CHANGED; iguales ⇒ null', () => {
    expect(mesaFields({ ...base, derivedPriceCents: 3900, quotedPriceCents: 4000, quotedMarketMxnCents: 12000 }).sinceQuote)
      .toMatchObject({ reasonCode: 'MARKET_DOWN', deltaCents: -100 });
    expect(mesaFields({ ...base, derivedPriceCents: 4100, quotedPriceCents: 4000 }).sinceQuote)
      .toMatchObject({ reasonCode: 'CURVE_CHANGED', deltaCents: 100 });
    expect(mesaFields(base).sinceQuote).toBeNull();
    expect(mesaFields({ ...base, derivedPriceCents: null, priceBasis: 'pending' }).sinceQuote).toBeNull();
  });

  it('sinceQuote IMP-1: bounty ⇒ BOUNTY; override ⇒ MANUAL_OVERRIDE (prioridad sobre mercado)', () => {
    expect(mesaFields({ ...base, derivedPriceCents: 5000, priceBasis: 'bounty', quotedPriceCents: 4000 }).sinceQuote)
      .toMatchObject({ reasonCode: 'BOUNTY', deltaCents: 1000 });
    expect(mesaFields({ ...base, derivedPriceCents: 3000, priceBasis: 'override', quotedPriceCents: 4000 }).sinceQuote)
      .toMatchObject({ reasonCode: 'MANUAL_OVERRIDE', deltaCents: -1000 });
    // override gana a bounty y a mercado movido
    expect(mesaFields({ ...base, marketMxnCents: 17177, derivedPriceCents: 3000, priceBasis: 'override', quotedPriceCents: 4000 }).sinceQuote)
      .toMatchObject({ reasonCode: 'MANUAL_OVERRIDE' });
    // sin bounty/override el mercado movido sigue mandando
    expect(mesaFields({ ...base, marketMxnCents: 12000, derivedPriceCents: 4800, priceBasis: 'market', quotedPriceCents: 4000 }).sinceQuote)
      .toMatchObject({ reasonCode: 'MARKET_UP' });
  });

  it('la nota sinceQuote NO crea ajuste (el chip va contra el estándar)', () => {
    const r = mesaFields({ ...base, derivedPriceCents: 4100, curveQuoteCents: 4100, quotedPriceCents: 4000 });
    expect(r.adjustment).toBeNull();
    expect(r.sinceQuote).not.toBeNull();
  });

  it('paridad con el seam de dinero: estándar y derivado salen de quoteAcquisitionWithGuard', () => {
    for (const market of [1500, 8000, 17177, 99999, 250000]) {
      const q = quoteAcquisitionWithGuard(market, DEFAULT_PRICING_CURVE, null);
      const r = mesaFields({
        marketMxnCents: q.marketMxnCents, curveQuoteCents: q.curveQuoteCents,
        derivedPriceCents: q.priceCents, priceBasis: q.basis,
        quotedPriceCents: q.priceCents, quotedMarketMxnCents: market,
      });
      expect(r.standardOfferCents).toBe(q.priceCents);
      expect(r.adjustment).toBeNull();
    }
  });
});

describe('mxn', () => {
  it.each([[17084, 'MX$170.84'], [5, 'MX$0.05'], [123456789, 'MX$1,234,567.89']])('%i', (c, t) => {
    expect(mxn(c)).toBe(t);
  });
});

describe('mesaFields MESA-2: motivo del override', () => {
  const ov = { ...base, derivedPriceCents: 3000, priceBasis: 'override' as const, quotedPriceCents: 3000 };
  it('cita el motivo si existe', () => {
    expect(mesaFields({ ...ov, overrideReason: 'daño en esquina' }).adjustment?.reasonText).toContain('motivo: daño en esquina');
  });
  it('sin motivo: texto de siempre', () => {
    expect(mesaFields(ov).adjustment?.reasonText).toBe('Precio fijado por el staff para esta carta');
  });
});
