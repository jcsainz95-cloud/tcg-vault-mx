import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import es from '../../../../../../messages/es.json';
import en from '../../../../../../messages/en.json';
import { mockSealedGroups } from '@/lib/mock/fixtures';
import type { SealedGroupDetailResponse } from '@/types/contract';

/*
 * API_CONTRACT §MKT.A.1 (v1.115⟨mkt-conv2⟩, criterio 951) — CNV-F1 y CNV-F2 sobre el componente de servidor de la ficha
 * de sellado (metadata + JSON-LD que Next pinta en el HTML crudo). El HTML crudo contra el stack real, con «Agotado»
 * visible: `e2e/seo-raw-html.spec.ts` (`@real`).
 *
 * Canarios del contrato: pintar `fromPriceCents ?? 0` ⇒ aparece `"price"` (CNV-F1); canonical a la URL pedida ⇒ rojo
 * (CNV-F2).
 */
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
    createTranslator({ locale, messages: locale === 'en' ? en : es, namespace } as never),
}));
vi.mock('@/components/i18n/RouteMessages', () => ({
  RouteMessages: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./SealedDetailView', () => ({ SealedDetailView: () => null }));
const ssr = vi.hoisted(() => ({ detail: null as unknown }));
vi.mock('@/lib/catalog-ssr', () => ({
  DETAIL_NOT_FOUND: 'not_found',
  loadSealedDetailForSSR: async () => ssr.detail,
  loadShippingRuleForSSR: async () => ({ cardsOnlyFeeCents: 10000, sealedFeeCents: 20000, freeFromCents: 400000, currency: 'MXN' }),
}));

import SealedDetailPage, { generateMetadata } from './page';

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tcghunt.mx').replace(/\/+$/, '');
const BASE = mockSealedGroups[0];
const REQUESTED = 'inv-sold-0001';

/** La respuesta de §MKT.A.1 para un grupo AGOTADO pedido por una pieza vendida: el representante es la pedida. */
function soldOutDetail(): SealedGroupDetailResponse {
  return {
    group: {
      ...BASE,
      representativeItemId: REQUESTED,
      availableCount: 0,
      fromPriceCents: null,
      priceSource: null,
      priceBasis: 'pending',
      referenceValue: { status: 'pending' } as SealedGroupDetailResponse['group']['referenceValue'],
      referenceDisplayCents: undefined,
      pricedAsOf: '2026-10-31',
    },
    listings: [],
    trendEnabled: false,
    restockEnabled: true,
  };
}

/** Pieza pedida ya vendida, pero el grupo sigue a la venta: el representante es OTRA pieza (CNV-F2). */
function regroupedDetail(): SealedGroupDetailResponse {
  return {
    group: { ...BASE, representativeItemId: 'inv-1008', pricedAsOf: '2026-10-31' },
    listings: [
      {
        inventoryItemId: 'inv-1008',
        card: BASE.card,
        productType: 'sealed',
        sealedSubtype: BASE.sealedSubtype ?? undefined,
        sealedCondition: BASE.sealedCondition,
        finish: 'normal',
        referenceValue: BASE.referenceValue,
        priceBasis: BASE.priceBasis,
        displayPriceCents: BASE.fromPriceCents,
        ivaIncluded: true,
        ivaRatePct: 16,
        sellable: true,
      },
    ],
    trendEnabled: false,
    restockEnabled: false,
  };
}

const params = (locale: 'es' | 'en') => Promise.resolve({ locale, inventoryItemId: REQUESTED });

function product(container: HTMLElement): Record<string, unknown> {
  const s = container.querySelector('script[type="application/ld+json"]')!;
  const graph = (JSON.parse(s.innerHTML) as { '@graph': Record<string, unknown>[] })['@graph'];
  return graph.find((n) => n['@type'] === 'Product')!;
}

beforeEach(() => {
  ssr.detail = soldOutDetail();
});
afterEach(cleanup);

describe('CNV-F1 · sellado agotado: OutOfStock sin precio, og sin MX$', () => {
  it.each(['es', 'en'] as const)('JSON-LD `Offer` OutOfStock sin `price` ni `priceValidUntil` (%s)', async (locale) => {
    const { container } = render(await SealedDetailPage({ params: params(locale) }));
    const offer = product(container).offers as Record<string, unknown>;
    expect(offer.availability).toBe('https://schema.org/OutOfStock');
    expect(offer).not.toHaveProperty('price');
    expect(offer).not.toHaveProperty('priceValidUntil');
    expect(offer).not.toHaveProperty('shippingDetails');
    expect(offer.priceCurrency).toBe('MXN');
    const raw = container.querySelector('script[type="application/ld+json"]')!.innerHTML;
    expect(raw).not.toMatch(/"price"\s*:/);
  });

  it.each(['es', 'en'] as const)('description y og:description sin precio (%s)', async (locale) => {
    const m = await generateMetadata({ params: params(locale) });
    for (const d of [m.description, m.openGraph?.description, m.twitter?.description]) {
      expect(d).toBeTruthy();
      expect(String(d)).not.toMatch(/MX\$|\$\s?\d/);
      expect(String(d)).not.toMatch(/\bdesde\b|\bfrom\b/i);
    }
  });

  it('canonical del agotado = su propia pieza (`representativeItemId` = la pedida)', async () => {
    const m = await generateMetadata({ params: params('es') });
    expect(m.alternates?.canonical).toBe(`${SITE}/es/sellado/${REQUESTED}`);
    expect(m.robots).toBeUndefined();
  });
});

describe('CNV-F2 · pieza vendida cuyo grupo sigue a la venta: canonical al representante', () => {
  beforeEach(() => {
    ssr.detail = regroupedDetail();
  });

  it.each(['es', 'en'] as const)('canonical, hreflang, og:url y Offer.url a `representativeItemId` (%s)', async (locale) => {
    const m = await generateMetadata({ params: params(locale) });
    const want = `${SITE}/${locale}/sellado/inv-1008`;
    expect(m.alternates?.canonical).toBe(want);
    expect(m.alternates?.languages).toMatchObject({ es: `${SITE}/es/sellado/inv-1008`, en: `${SITE}/en/sellado/inv-1008` });
    expect((m.openGraph as { url?: string }).url).toBe(want);
    expect(JSON.stringify(m)).not.toContain(REQUESTED);

    const { container } = render(await SealedDetailPage({ params: params(locale) }));
    const offer = product(container).offers as Record<string, unknown>;
    expect(offer.url).toBe(want);
    expect(offer.availability).toBe('https://schema.org/InStock');
    expect(offer.price).toBe((BASE.fromPriceCents / 100).toFixed(2));
  });
});
