import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { NONCE_HEADER } from '@/security/csp';
import { organizationJsonLd, SITE_URL } from '@/lib/seo';
import { breadcrumb, contentCanonical, howItWorksSections, webPageJsonLd } from '@/lib/seo-content';
import { FAQ_LAST_REVIEW, FAQ_MANUAL_VERSION } from '@/content/seo/faq.es';
import { ContentPage, EmptyContent, FaqGroups } from '../_content/ContentPage';
import { RouteMessages } from '@/components/i18n/RouteMessages';

/**
 * ⭐ §MKT tienda §E4 — `/como-funciona` (brief v1 §3.1). Compone respuestas públicas de
 * `RESPUESTAS.md` §12.2 por id (`content/seo/como-funciona.es.ts`): no hay texto propio de marketing
 * para esta página y la tienda no lo redacta. JSON-LD `WebPage` + `Organization` + `BreadcrumbList`
 * (v1 §3.1). ⛔ Sin `FAQPage` aquí: las mismas preguntas ya van marcadas en `/preguntas` y el manual
 * pide no duplicar `Question` (§12.0 regla 5).
 */
export const revalidate = 3600;

const PATH = '/como-funciona';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'seo' });
  const tc = await getTranslations({ locale, namespace: 'common' });
  return {
    metadataBase: new URL(SITE_URL),
    title: `${tc('appName')} — ${t('howItWorks.title')}`,
    description: t('howItWorks.description'),
    alternates: { canonical: contentCanonical(PATH) },
  };
}

export default async function ComoFuncionaPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [t, tc, nonce] = await Promise.all([
    getTranslations({ locale, namespace: 'seo' }),
    getTranslations({ locale, namespace: 'common' }),
    headers().then((h) => h.get(NONCE_HEADER) ?? undefined),
  ]);
  const sections = howItWorksSections();
  const url = contentCanonical(PATH);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      webPageJsonLd({ name: t('howItWorks.title'), url, dateModified: FAQ_LAST_REVIEW }),
      organizationJsonLd(),
      breadcrumb([
        { name: tc('appName'), path: '' },
        { name: t('howItWorks.title'), path: PATH },
      ]),
    ],
  };

  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <>
        <JsonLd data={jsonLd} nonce={nonce} />
        <ContentPage
          title={t('howItWorks.title')}
          dateLine={t('lastReview', { date: FAQ_LAST_REVIEW, version: FAQ_MANUAL_VERSION })}
          spanishOnlyNotice={locale !== 'es' ? t('spanishOnly') : undefined}
        >
          {sections.length > 0 ? (
            <FaqGroups groups={sections} />
          ) : (
            <EmptyContent message={t('howItWorks.empty')} />
          )}
        </ContentPage>
      </>
    </RouteMessages>
  );
}
