import { Suspense } from 'react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { AppLocale } from '@/i18n/routing';
import { JsonLd } from '@/components/seo/JsonLd';
import { NONCE_HEADER } from '@/security/csp';
import { breadcrumbJsonLd, SITE_URL, siteAbsoluteUrl } from '@/lib/seo';
import { CatalogView } from './CatalogView';

/**
 * §E1/§E3 — canonical absoluto SIN query: las vistas filtradas (`?setId=`, `?type=graded`) apuntan
 * todas a `/{locale}/catalog`, para no indexar duplicados del mismo catálogo.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: AppLocale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    metadataBase: new URL(SITE_URL),
    alternates: { canonical: siteAbsoluteUrl(`/${locale}/catalog`) },
  };
}

/**
 * §MKT tienda §E1/§E3 (brief v1 §2.3) — `BreadcrumbList` en el catálogo (Inicio → Catálogo), en el
 * HTML del servidor, como en las fichas.
 */
export default async function CatalogPage({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const { locale } = await params;
  const [t, nonce] = await Promise.all([
    getTranslations({ locale }),
    headers().then((h) => h.get(NONCE_HEADER) ?? undefined),
  ]);
  const jsonLd = {
    '@context': 'https://schema.org',
    ...breadcrumbJsonLd([
      { name: t('common.appName'), url: siteAbsoluteUrl(`/${locale}`) },
      { name: t('nav.catalog'), url: siteAbsoluteUrl(`/${locale}/catalog`) },
    ]),
  };
  // useSearchParams (pestaña Gradeadas, ?type=graded) requiere Suspense en Next 15.
  return (
    <>
      <JsonLd data={jsonLd} nonce={nonce} />
      <Suspense>
        <CatalogView />
      </Suspense>
    </>
  );
}
