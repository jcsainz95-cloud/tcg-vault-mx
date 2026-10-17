import type { Metadata } from 'next';
import type { AppLocale } from '@/i18n/routing';
import { SITE_URL, siteAbsoluteUrl } from '@/lib/seo';
import { HomeView } from './HomeView';

/**
 * §E1/§E3 — la portada es un envoltorio de servidor para poder emitir el `canonical` absoluto en el
 * HTML inicial (`/{locale}`). El cuerpo (hero, cotizador, estantes) vive en `HomeView` ('use client'):
 * usa react-query, sesión y los estantes interactivos.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: AppLocale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    metadataBase: new URL(SITE_URL),
    alternates: { canonical: siteAbsoluteUrl(`/${locale}`) },
  };
}

export default function HomePage() {
  return <HomeView />;
}
