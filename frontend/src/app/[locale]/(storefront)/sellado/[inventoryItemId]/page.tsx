import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { AppLocale } from '@/i18n/routing';
import { NONCE_HEADER } from '@/security/csp';
import { formatMoneyCents } from '@/lib/format';
import { loadSealedDetailForSSR, loadShippingRuleForSSR } from '@/lib/catalog-ssr';
import {
  SITE_URL,
  brandJsonLd,
  breadcrumbJsonLd,
  jsonLdItemCondition,
  localeAlternates,
  merchantReturnPolicyJsonLd,
  shippingDetailsJsonLd,
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
import { RouteMessages } from '@/components/i18n/RouteMessages';

/**
 * Ficha pública de producto SELLADO (§A3/§A4) — SSR: el `<head>` (title/og/JSON-LD) viaja en el HTML
 * del servidor para las vistas previas de Instagram/WhatsApp y los buscadores. El cuerpo también sale
 * del servidor: la misma lectura viaja a `SealedDetailView` como `initialData` (C1). La ruta se CONSERVA en
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
    return { metadataBase: new URL(SITE_URL), alternates: localeAlternates(locale, `/sellado/${encodeURIComponent(inventoryItemId)}`) };
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
    alternates: localeAlternates(locale, `/sellado/${encodeURIComponent(inventoryItemId)}`),
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
  const [data, t, nonce, shippingRule] = await Promise.all([
    loadSealedDetailForSSR(inventoryItemId),
    getTranslations({ locale }),
    headers().then((h) => h.get(NONCE_HEADER) ?? undefined),
    loadShippingRuleForSSR(),
  ]);

  let jsonLd: Record<string, unknown> | null = null;
  if (data) {
    const g = data.group;
    const canonical = sealedCanonicalUrl(locale, inventoryItemId);
    const until = priceValidUntil(g.pricedAsOf);
    const shippingDetails = shippingDetailsJsonLd('sealed', g.fromPriceCents, shippingRule);
    jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Product',
          name: g.productName,
          ...(g.ogImageUrl ? { image: [g.ogImageUrl] } : {}),
          // C5: marca, condición, envío y devoluciones (con datos que ya existen en el sitio; ver `lib/seo.ts`).
          brand: brandJsonLd(),
          offers: {
            '@type': 'Offer',
            priceCurrency: 'MXN',
            price: jsonLdPrice(g.fromPriceCents),
            availability: jsonLdAvailability(g.availableCount),
            itemCondition: jsonLdItemCondition('sealed'),
            url: canonical,
            ...(until ? { priceValidUntil: until } : {}),
            ...(shippingDetails ? { shippingDetails } : {}),
            hasMerchantReturnPolicy: merchantReturnPolicyJsonLd(),
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

  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <>
        {jsonLd && <JsonLd data={jsonLd} nonce={nonce} />}
        <SealedDetailView inventoryItemId={inventoryItemId} initialData={data ?? undefined} />
      </>
    </RouteMessages>
  );
}
