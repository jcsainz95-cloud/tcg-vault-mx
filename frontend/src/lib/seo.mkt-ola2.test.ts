import { describe, it, expect } from 'vitest';
import {
  SITE_URL,
  brandJsonLd,
  jsonLdItemCondition,
  localeAlternates,
  merchantReturnPolicyJsonLd,
  organizationJsonLd,
  routeMetadata,
  shippingDetailsJsonLd,
  webSiteJsonLd,
} from './seo';
import { latest, spanishDateToIso } from './sitemap-lastmod';

/**
 * BRIEF_MKT Ola 2 · helpers puros de C4/C5/C6 (`lib/seo.ts`, `lib/sitemap-lastmod.ts`). El HTML crudo servido lo
 * cubre `e2e/seo-raw-html.spec.ts` contra el stack real; aquí se fijan las reglas en sus bordes.
 */
const RULE = { cardsOnlyFeeCents: 10_000, sealedFeeCents: 17_500, freeFromCents: 400_000, currency: 'MXN' as const };

describe('C5 · Product completo', () => {
  it('shippingDetails: carta MX$100, sellado MX$175, gratis DESDE MX$4,000 (>=, como shipping-rule.ts)', () => {
    const rate = (kind: 'card' | 'sealed', cents: number) =>
      (shippingDetailsJsonLd(kind, cents, RULE)!.shippingRate as { value: string }).value;
    expect(rate('card', 8_120)).toBe('100.00');
    expect(rate('sealed', 52_200)).toBe('175.00');
    expect(rate('card', 399_999)).toBe('100.00');
    expect(rate('card', 400_000)).toBe('0.00');
    expect(rate('sealed', 400_000)).toBe('0.00');
    expect(shippingDetailsJsonLd('card', 8_120, RULE)!.shippingDestination).toEqual({
      '@type': 'DefinedRegion',
      addressCountry: 'MX',
    });
  });

  it('sin regla (backend sin responder) el campo se omite: ningún importe escrito a mano', () => {
    expect(shippingDetailsJsonLd('card', 8_120, null)).toBeUndefined();
  });

  it('itemCondition: carta = usada (salió de su sobre), sellado = nuevo; marca Pokémon; sin devoluciones', () => {
    expect(jsonLdItemCondition('card')).toBe('https://schema.org/UsedCondition');
    expect(jsonLdItemCondition('sealed')).toBe('https://schema.org/NewCondition');
    expect(brandJsonLd()).toEqual({ '@type': 'Brand', name: 'Pokémon' });
    expect(merchantReturnPolicyJsonLd().returnPolicyCategory).toBe('https://schema.org/MerchantReturnNotPermitted');
  });
});

describe('C4/C6 · canonical, hreflang, WebSite y logo', () => {
  it('x-default apunta a la versión es (200), nunca a la URL sin locale (307)', () => {
    const alt = localeAlternates('en', '/catalog');
    expect(alt.canonical).toBe(`${SITE_URL}/en/catalog`);
    expect(alt.languages).toEqual({
      es: `${SITE_URL}/es/catalog`,
      en: `${SITE_URL}/en/catalog`,
      'x-default': `${SITE_URL}/es/catalog`,
    });
    expect(localeAlternates('es', '').canonical).toBe(`${SITE_URL}/es`);
  });

  it('routeMetadata lleva título, descripción, canonical y og propios', () => {
    const m = routeMetadata({ locale: 'es', path: '/sellado', title: 'T', description: 'D' });
    expect(m.title).toBe('T');
    expect(m.description).toBe('D');
    expect(m.alternates?.canonical).toBe(`${SITE_URL}/es/sellado`);
    expect((m.openGraph as { url: string }).url).toBe(`${SITE_URL}/es/sellado`);
  });

  it('WebSite + SearchAction usa la búsqueda del catálogo (?q=)', () => {
    const w = webSiteJsonLd('es');
    const action = w.potentialAction as { target: { urlTemplate: string }; 'query-input': string };
    expect(action.target.urlTemplate).toBe(`${SITE_URL}/es/catalog?q={search_term_string}`);
    expect(action['query-input']).toBe('required name=search_term_string');
  });

  it('Organization lleva logo absoluto (la mira de la marca)', () => {
    expect(organizationJsonLd().logo).toBe(`${SITE_URL}/apple-icon.png`);
  });

  it('lastmod: fecha del aviso y la más reciente de una lista', () => {
    expect(spanishDateToIso('26 de octubre de 2026')).toBe('2026-10-26');
    expect(spanishDateToIso('3 de enero de 2027')).toBe('2027-01-03');
    expect(spanishDateToIso('octubre 2026')).toBeUndefined();
    expect(latest(['2026-10-10T00:00:00.000Z', undefined, '2026-10-12T00:00:00.000Z'])).toBe('2026-10-12T00:00:00.000Z');
    expect(latest([])).toBeUndefined();
  });
});
