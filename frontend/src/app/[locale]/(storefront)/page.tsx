import type { Metadata } from 'next';
import * as ReactDOM from 'react-dom';
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';
import type { AppLocale } from '@/i18n/routing';
import { SITE_URL, siteAbsoluteUrl } from '@/lib/seo';
import { FEATURED_QUERY_KEY, GEMS_QUERY_KEY } from '@/lib/home-queries';
import { leadImageOf, loadHomeForSSR } from '@/lib/home-ssr';
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

/**
 * Precarga de la foto líder de Destacadas (candidata a LCP). `preload` es de React 19 (el que usa el App Router de
 * Next); con el React 18 de la suite unitaria no existe y se omite.
 */
function preloadLeadImage(href: string | null) {
  const preload = (ReactDOM as unknown as { preload?: (href: string, o: { as: 'image'; fetchPriority: 'high' }) => void })
    .preload;
  if (href && typeof preload === 'function') preload(href, { as: 'image', fetchPriority: 'high' });
}

/**
 * v1.113⟨portada⟩ (API_CONTRACT §DYN.6.2, DYN-F2) — la portada pide en el SERVIDOR Destacadas (`GET /catalog/featured`)
 * y la vitrina «Joyas para gradear», con la caché de datos de Next (30 s) y un tope de 400 ms (`lib/home-ssr.ts`).
 *  - Con datos: las tejas salen en el HTML (con la `<img>` líder, precargada) e hidratan react-query con la MISMA clave
 *    que usan los hooks del cliente. `updatedAt: 0` ⇒ el dato nace «viejo» y el cliente lo revalida al montar (una pieza
 *    vendida sale, ≤ 60 s, ARCHITECTURE §4.DYN (f) 3).
 *  - Sin datos a tiempo: no se hidrata esa clave; el carrusel pinta su MARCO con el alto reservado y el cliente rellena
 *    (criterio 937). La vitrina, por su excepción de §22.6, aparece ya resuelta o no aparece.
 * El HTML se sigue renderizando por petición (nonce de la CSP, §DYN.6.3): solo se cachean datos.
 */
export default async function HomePage() {
  const { featured, gems } = await loadHomeForSSR();
  const client = new QueryClient();
  if (featured) client.setQueryData(FEATURED_QUERY_KEY, featured, { updatedAt: 0 });
  if (gems) client.setQueryData(GEMS_QUERY_KEY, gems, { updatedAt: 0 });
  preloadLeadImage(leadImageOf(featured));
  return (
    <HydrationBoundary state={dehydrate(client)}>
      <HomeView />
    </HydrationBoundary>
  );
}
