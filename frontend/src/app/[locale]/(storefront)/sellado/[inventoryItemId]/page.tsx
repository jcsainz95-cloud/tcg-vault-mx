import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { AppLocale } from '@/i18n/routing';
import { NONCE_HEADER } from '@/security/csp';
import { formatMoneyCents } from '@/lib/format';
import { notFound } from 'next/navigation';
import { DETAIL_NOT_FOUND, loadSealedDetailForSSR, loadShippingRuleForSSR } from '@/lib/catalog-ssr';
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
  soldOutOfferJsonLd,
  isSealedSoldOut,
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
 *
 * §MKT.A.1 (v1.115⟨mkt-conv2⟩, criterio 951; ARCHITECTURE §13.8 (a)/(b)): el backend responde `404` SOLO si la pieza no
 * existe o no es sellada ⇒ `notFound()`. La URL nombra una pieza, pero la ficha es la del GRUPO de ahora:
 *  - grupo con existencia (aunque la pieza pedida ya se vendiera) ⇒ canonical = `group.representativeItemId`;
 *  - grupo AGOTADO (`listings: []`, `availableCount 0`, `fromPriceCents`/`priceSource` `null`) ⇒ `200` indexable:
 *    «Agotado» en el cuerpo, `Offer` `OutOfStock` SIN `price` ni `priceValidUntil` y `og:description` sin precio
 *    (no hay «último precio»: lo no vendible no tiene precio que se cobre). Canonical = la propia pieza
 *    (`representativeItemId` = la pedida en el caso agotado).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: AppLocale; inventoryItemId: string }>;
}): Promise<Metadata> {
  const { locale, inventoryItemId } = await params;
  const data = await loadSealedDetailForSSR(inventoryItemId);
  if (data === DETAIL_NOT_FOUND) notFound();
  if (!data) {
    // Sin dato (backend caído o lento): metadata mínima; el cuerpo cliente resuelve.
    return { metadataBase: new URL(SITE_URL), alternates: localeAlternates(locale, `/sellado/${encodeURIComponent(inventoryItemId)}`) };
  }
  const g = data.group;
  // §MKT.A.1: canonical (y hreflang) a la pieza que representa el grupo, no a la URL pedida.
  const canonical = sealedCanonicalUrl(locale, g.representativeItemId);
  const title = `${g.productName} | TCG HUNT`;
  const description = buildFichaDescription({
    conditionLabel: sealedConditionLabel(g.sealedCondition, locale),
    // Agotado ⇒ sin precio (§MKT.A.1); `buildFichaDescription` omite el tramo «desde … · precio al …».
    priceText: isSealedSoldOut(data) || g.fromPriceCents == null ? null : formatMoneyCents(g.fromPriceCents, locale),
    pricedAsOf: g.pricedAsOf,
    locale,
  });
  const ogImage = g.ogImageUrl ?? undefined;
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: localeAlternates(locale, `/sellado/${encodeURIComponent(g.representativeItemId)}`),
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
  if (data === DETAIL_NOT_FOUND) notFound();

  let jsonLd: Record<string, unknown> | null = null;
  if (data) {
    const g = data.group;
    const canonical = sealedCanonicalUrl(locale, g.representativeItemId);
    const priceCents = isSealedSoldOut(data) ? null : g.fromPriceCents;
    const until = priceValidUntil(g.pricedAsOf);
    const shippingDetails = priceCents != null ? shippingDetailsJsonLd('sealed', priceCents, shippingRule) : undefined;
    jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Product',
          name: g.productName,
          ...(g.ogImageUrl ? { image: [g.ogImageUrl] } : {}),
          // C5: marca, condición, envío y devoluciones (con datos que ya existen en el sitio; ver `lib/seo.ts`).
          brand: brandJsonLd(),
          offers:
            priceCents != null
              ? {
                  '@type': 'Offer',
                  priceCurrency: 'MXN',
                  price: jsonLdPrice(priceCents),
                  availability: jsonLdAvailability(g.availableCount),
                  itemCondition: jsonLdItemCondition('sealed'),
                  url: canonical,
                  ...(until ? { priceValidUntil: until } : {}),
                  ...(shippingDetails ? { shippingDetails } : {}),
                  hasMerchantReturnPolicy: merchantReturnPolicyJsonLd(),
                }
              : // §MKT.A.1 / §13.8 (b): agotado ⇒ `OutOfStock`, sin `price` ni `priceValidUntil` (mismo `Offer` que la carta).
                soldOutOfferJsonLd('sealed', canonical),
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
