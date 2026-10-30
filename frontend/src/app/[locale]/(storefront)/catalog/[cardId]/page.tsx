import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { AppLocale } from '@/i18n/routing';
import type { GroupedListingDTO } from '@/types/contract';
import { NONCE_HEADER } from '@/security/csp';
import { formatMoneyCents } from '@/lib/format';
import { loadCardDetailForSSR } from '@/lib/catalog-ssr';
import {
  SITE_URL,
  breadcrumbJsonLd,
  buildFichaDescription,
  cardCanonicalUrl,
  cardConditionLabel,
  jsonLdAvailability,
  jsonLdPrice,
  organizationJsonLd,
  priceValidUntil,
  siteAbsoluteUrl,
} from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { CardDetailView } from './CardDetailView';
import { RouteMessages } from '@/components/i18n/RouteMessages';

/**
 * Ficha pública de CARTA (§A4/§E3) — SSR: title/og/JSON-LD en el HTML del servidor; el cuerpo lo
 * pinta la vista cliente (`CardDetailView`). El precio de la ficha es «desde» (el del listado más
 * barato). El layout de `[locale]` fuerza render por petición ⇒ SSR.
 */

/** El listado representante = el más barato (la cifra «desde» de la ficha). */
function cheapestListing(listings: GroupedListingDTO[]): GroupedListingDTO | undefined {
  return [...listings].sort((a, b) => a.displayPriceCents - b.displayPriceCents)[0];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: AppLocale; cardId: string }>;
}): Promise<Metadata> {
  const { locale, cardId } = await params;
  const canonical = cardCanonicalUrl(locale, cardId);
  const data = await loadCardDetailForSSR(cardId);
  if (!data) {
    return { metadataBase: new URL(SITE_URL), alternates: { canonical } };
  }
  const { card } = data;
  const rep = cheapestListing(data.listings);
  const title = `${card.name} · ${card.setName} ${card.number} | TCG HUNT`;
  const description = buildFichaDescription({
    conditionLabel: rep
      ? cardConditionLabel(
          {
            productType: rep.productType,
            rawCondition: rep.rawCondition,
            gradingCompany: rep.gradingCompany,
            gradeValue: rep.gradeValue,
          },
          locale,
        )
      : locale === 'en'
        ? 'Pokémon card'
        : 'Carta Pokémon',
    priceText: rep ? formatMoneyCents(rep.displayPriceCents, locale) : null,
    ivaRatePct: rep?.ivaRatePct,
    pricedAsOf: data.pricedAsOf,
    locale,
  });
  const ogImage = data.ogImageUrl ?? undefined;
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      siteName: 'TCG HUNT',
      title,
      description,
      url: canonical,
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ locale: AppLocale; cardId: string }>;
}) {
  const { locale, cardId } = await params;
  const [data, t, nonce] = await Promise.all([
    loadCardDetailForSSR(cardId),
    getTranslations({ locale }),
    headers().then((h) => h.get(NONCE_HEADER) ?? undefined),
  ]);

  let jsonLd: Record<string, unknown> | null = null;
  if (data) {
    const { card } = data;
    const canonical = cardCanonicalUrl(locale, cardId);
    const rep = cheapestListing(data.listings);
    const availableCount = data.listings.reduce((n, l) => n + l.stockCount, 0);
    const until = priceValidUntil(data.pricedAsOf);
    jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Product',
          name: `${card.name} · ${card.setName} ${card.number}`,
          ...(data.ogImageUrl ? { image: [data.ogImageUrl] } : {}),
          ...(rep
            ? {
                offers: {
                  '@type': 'Offer',
                  priceCurrency: 'MXN',
                  price: jsonLdPrice(rep.displayPriceCents),
                  availability: jsonLdAvailability(availableCount),
                  url: canonical,
                  ...(until ? { priceValidUntil: until } : {}),
                },
              }
            : {}),
        },
        organizationJsonLd(),
        breadcrumbJsonLd([
          { name: t('common.appName'), url: siteAbsoluteUrl(`/${locale}`) },
          { name: t('nav.catalog'), url: siteAbsoluteUrl(`/${locale}/catalog`) },
          { name: card.name, url: canonical },
        ]),
      ],
    };
  }

  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <>
        {jsonLd && <JsonLd data={jsonLd} nonce={nonce} />}
        <CardDetailView cardId={cardId} />
      </>
    </RouteMessages>
  );
}
