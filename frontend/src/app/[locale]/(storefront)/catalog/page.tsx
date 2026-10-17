import { Suspense } from 'react';
import type { Metadata } from 'next';
import type { AppLocale } from '@/i18n/routing';
import { SITE_URL, siteAbsoluteUrl } from '@/lib/seo';
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

export default function CatalogPage() {
  // useSearchParams (pestaña Gradeadas, ?type=graded) requiere Suspense en Next 15.
  return (
    <Suspense>
      <CatalogView />
    </Suspense>
  );
}
