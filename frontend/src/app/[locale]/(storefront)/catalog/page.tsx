import { Suspense } from 'react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { AppLocale } from '@/i18n/routing';
import { JsonLd } from '@/components/seo/JsonLd';
import { NONCE_HEADER } from '@/security/csp';
import { breadcrumbJsonLd, routeMetadata, siteAbsoluteUrl } from '@/lib/seo';
import { loadCatalogPageForSSR } from '@/lib/catalog-ssr';
import { CatalogView, type CatalogInitialPage } from './CatalogView';
import { DEFAULT_CATALOG_SORT, parseUrlFilters, sealedIntentOf } from './catalog-url';
import { RouteMessages } from '@/components/i18n/RouteMessages';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Los `searchParams` de la página como `URLSearchParams` (el primer valor de cada clave, como `useSearchParams().get`). */
function toUrlParams(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const first = Array.isArray(v) ? v[0] : v;
    if (first != null) out.set(k, first);
  }
  return out;
}

/**
 * §E1/§E3 — canonical absoluto SIN query: las vistas filtradas (`?setId=`, `?productType=graded`, `?page=`) apuntan
 * todas a `/{locale}/catalog`, para no indexar duplicados del mismo catálogo. C4: título y descripción propios
 * (antes heredaba los de la portada).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: AppLocale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const [t, tc] = await Promise.all([
    getTranslations({ locale, namespace: 'seo.pages.catalog' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  return routeMetadata({
    locale,
    path: '/catalog',
    title: `${tc('appName')} — ${t('title')}`,
    description: t('description'),
  });
}

/**
 * §MKT tienda §E1/§E3 (brief v1 §2.3) — `BreadcrumbList` en el catálogo (Inicio → Catálogo), en el
 * HTML del servidor, como en las fichas.
 *
 * C2 (BRIEF_MKT Ola 2) — la página pedida (`?page=`, filtros de la URL) se lee en el SERVIDOR con los mismos filtros
 * que deriva la vista (`parseUrlFilters`) y viaja como `initialData`: las tejas, con su `<a href>` a cada ficha, y el
 * paginador con `<a href="?page=n">` salen en el HTML crudo. Tope `CATALOG_SSR_BUDGET_MS`: sin dato a tiempo, el
 * HTML sale con el esqueleto y la vista pide sola (lo de antes). Una URL de sellado (D-EQ-3) no se lee aquí: la
 * vista la desvía a `/sellado`.
 */
export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: AppLocale }>;
  searchParams?: SearchParams;
}) {
  const { locale } = await params;
  const sp = toUrlParams((await searchParams) ?? {});
  const filters = parseUrlFilters(sp);
  const [t, nonce, data] = await Promise.all([
    getTranslations({ locale }),
    headers().then((h) => h.get(NONCE_HEADER) ?? undefined),
    sealedIntentOf(sp) ? Promise.resolve(null) : loadCatalogPageForSSR(filters, DEFAULT_CATALOG_SORT),
  ]);
  // B-R2: la edad viaja con la página para que la vista revalide si la caché de datos sirvió una copia vieja.
  const initialPage: CatalogInitialPage | undefined = data ? { filters, data: data.data, ageMs: data.ageMs } : undefined;
  const jsonLd = {
    '@context': 'https://schema.org',
    ...breadcrumbJsonLd([
      { name: t('common.appName'), url: siteAbsoluteUrl(`/${locale}`) },
      { name: t('nav.catalog'), url: siteAbsoluteUrl(`/${locale}/catalog`) },
    ]),
  };
  // useSearchParams (pestaña Gradeadas, ?productType=graded) requiere Suspense en Next 15.
  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <>
        <JsonLd data={jsonLd} nonce={nonce} />
        <Suspense>
          <CatalogView initialPage={initialPage} />
        </Suspense>
      </>
    </RouteMessages>
  );
}
