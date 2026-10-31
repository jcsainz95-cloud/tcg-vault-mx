import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';
import type { AppLocale } from '@/i18n/routing';
import { NONCE_HEADER } from '@/security/csp';
import { JsonLd } from '@/components/seo/JsonLd';
import { SITE_URL, localeAlternates, organizationJsonLd, webSiteJsonLd } from '@/lib/seo';
import { FEATURED_QUERY_KEY, GEMS_QUERY_KEY } from '@/lib/home-queries';
import { loadHomeForSSR } from '@/lib/home-ssr';
import { RouteMessages } from '@/components/i18n/RouteMessages';
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
  const t = await getTranslations({ locale, namespace: 'seo.pages.home' });
  // C4/C6: descripción propia (antes = el lema) y canonical + hreflang; el título sigue siendo el del layout.
  return {
    metadataBase: new URL(SITE_URL),
    description: t('description'),
    alternates: localeAlternates(locale, ''),
  };
}

/**
 * v1.113⟨portada⟩ (API_CONTRACT §DYN.6.2, DYN-F2) — la portada pide en el SERVIDOR Destacadas (`GET /catalog/featured`)
 * y la vitrina «Joyas para gradear», con la caché de datos de Next (30 s) y un tope de 400 ms (`lib/home-ssr.ts`).
 *  - Con datos: las tejas salen en el HTML (con la `<img>` líder, que precarga el carrusel) e hidratan react-query con
 *    la MISMA clave que usan los hooks del cliente. `updatedAt: 0` ⇒ el dato nace «viejo» y el cliente lo revalida al montar (una pieza
 *    vendida sale, ≤ 60 s, ARCHITECTURE §4.DYN (f) 3).
 *  - Sin datos a tiempo: no se hidrata esa clave; el carrusel pinta su MARCO con el alto reservado y el cliente rellena
 *    (criterio 937). La vitrina, por su excepción de §22.6, aparece ya resuelta o no aparece.
 * El HTML se sigue renderizando por petición (nonce de la CSP, §DYN.6.3): solo se cachean datos.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const [{ featured, gems }, locale, nonce] = await Promise.all([
    loadHomeForSSR(),
    params.then((p) => p.locale),
    headers().then((h) => h.get(NONCE_HEADER) ?? undefined),
  ]);
  // C6 (BRIEF_MKT Ola 2): la portada lleva JSON-LD `WebSite` + `SearchAction` y la `Organization` con su logo.
  const jsonLd = { '@context': 'https://schema.org', '@graph': [webSiteJsonLd(locale), organizationJsonLd()] };
  const client = new QueryClient();
  if (featured) client.setQueryData(FEATURED_QUERY_KEY, featured, { updatedAt: 0 });
  if (gems) client.setQueryData(GEMS_QUERY_KEY, gems, { updatedAt: 0 });
  // §DYN.6.7 (c1): la portada añade SOLO el ámbito `home` a lo que manda la raíz (`SHELL`); el único `home` del árbol.
  return (
    <RouteMessages scope="home">
      <JsonLd data={jsonLd} nonce={nonce} />
      <HydrationBoundary state={dehydrate(client)}>
        <HomeView />
      </HydrationBoundary>
    </RouteMessages>
  );
}
