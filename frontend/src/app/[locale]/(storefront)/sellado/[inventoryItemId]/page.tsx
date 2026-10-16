import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { AppLocale } from '@/i18n/routing';
import { NONCE_HEADER } from '@/security/csp';
import { formatMoneyCents } from '@/lib/format';
import { loadSealedDetailForSSR } from '@/lib/catalog-ssr';
import {
  SITE_URL,
  breadcrumbJsonLd,
  buildFichaDescription,
  jsonLdAvailability,
  jsonLdPrice,
  organizationJsonLd,
  priceValidUntil,
  sealedCanonicalUrl,
  sealedConditionLabel,
  siteAbsoluteUrl,
} from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { SealedDetailView } from './SealedDetailView';

/**
 * Ficha pública de producto SELLADO (§A3/§A4) — SSR: el `<head>` (title/og/JSON-LD) viaja en el HTML
 * del servidor para las vistas previas de Instagram/WhatsApp y los buscadores. El cuerpo lo pinta la
 * vista cliente (`SealedDetailView`, con carrito y react-query). La ruta se CONSERVA en
 * `/{locale}/sellado/<inventoryItemId>` (decisión del arquitecto, §MKT.A). El layout de `[locale]`
 * fuerza render por petición (lee `headers()`), así que es SSR, no SSG.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: AppLocale; inventoryItemId: string }>;
}): Promise<Metadata> {
  const { locale, inventoryItemId } = await params;
  const canonical = sealedCanonicalUrl(locale, inventoryItemId);
  const data = await loadSealedDetailForSSR(inventoryItemId);
  if (!data) {
    // Sin dato (backend caído o pieza inexistente): metadata mínima; el cuerpo cliente resuelve.
    return { metadataBase: new URL(SITE_URL), alternates: { canonical } };
  }
  const g = data.group;
  const title = `${g.productName} | TCG HUNT`;
  const description = buildFichaDescription({
    conditionLabel: sealedConditionLabel(g.sealedCondition, locale),
    priceText: formatMoneyCents(g.fromPriceCents, locale),
    ivaRatePct: g.ivaRatePct,
    pricedAsOf: g.pricedAsOf,
    locale,
  });
  const ogImage = g.ogImageUrl ?? undefined;
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

export default async function SealedDetailPage({
  params,
}: {
  params: Promise<{ locale: AppLocale; inventoryItemId: string }>;
}) {
  const { locale, inventoryItemId } = await params;
  const [data, t, nonce] = await Promise.all([
    loadSealedDetailForSSR(inventoryItemId),
    getTranslations({ locale }),
    headers().then((h) => h.get(NONCE_HEADER) ?? undefined),
  ]);

  let jsonLd: Record<string, unknown> | null = null;
  if (data) {
    const g = data.group;
    const canonical = sealedCanonicalUrl(locale, inventoryItemId);
    const until = priceValidUntil(g.pricedAsOf);
    jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Product',
          name: g.productName,
          ...(g.ogImageUrl ? { image: [g.ogImageUrl] } : {}),
          offers: {
            '@type': 'Offer',
            priceCurrency: 'MXN',
            price: jsonLdPrice(g.fromPriceCents),
            availability: jsonLdAvailability(g.availableCount),
            url: canonical,
            ...(until ? { priceValidUntil: until } : {}),
          },
        },
        organizationJsonLd(),
        breadcrumbJsonLd([
          { name: t('common.appName'), url: siteAbsoluteUrl(`/${locale}`) },
          { name: t('nav.sealed'), url: siteAbsoluteUrl(`/${locale}/sellado`) },
          { name: g.productName, url: canonical },
        ]),
      ],
    };
  }

  return (
    <>
      {jsonLd && <JsonLd data={jsonLd} nonce={nonce} />}
      <SealedDetailView inventoryItemId={inventoryItemId} />
    </>
  );
}
