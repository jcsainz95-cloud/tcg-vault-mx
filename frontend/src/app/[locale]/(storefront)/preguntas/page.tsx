import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { NONCE_HEADER } from '@/security/csp';
import { organizationJsonLd, SITE_URL } from '@/lib/seo';
import {
  breadcrumb,
  contentCanonical,
  faqPageJsonLd,
  groupFaqs,
  publishedFaqs,
} from '@/lib/seo-content';
import { FAQ_LAST_REVIEW, FAQ_MANUAL_VERSION } from '@/content/seo/faq.es';
import { ContentPage, EmptyContent, FaqGroups } from '../_content/ContentPage';

/**
 * ⭐ §MKT tienda §E4 — `/preguntas` con JSON-LD `FAQPage`. El texto es `RESPUESTAS.md` §12.2 (manual
 * v5) tal cual (`content/seo/faq.es.ts`); el `FAQPage` se arma con el MISMO arreglo que se pinta, y
 * `preguntas/page.test.tsx` compara el DOM con el JSON-LD. Vencida una FAQ (`validThrough`), sale de
 * la página, del JSON-LD y del sitemap a la vez. Revalida cada hora para que el corte de fecha aplique
 * sin redeploy.
 */
export const revalidate = 3600;

const PATH = '/preguntas';

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
    title: `${tc('appName')} — ${t('faq.title')}`,
    description: t('faq.description'),
    // El contenido solo existe en español ⇒ `/en/preguntas` apunta a `/es/preguntas` (sin hreflang).
    alternates: { canonical: contentCanonical(PATH) },
  };
}

export default async function PreguntasPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const [t, tc, nonce] = await Promise.all([
    getTranslations({ locale, namespace: 'seo' }),
    getTranslations({ locale, namespace: 'common' }),
    headers().then((h) => h.get(NONCE_HEADER) ?? undefined),
  ]);
  const faqs = publishedFaqs();
  const url = contentCanonical(PATH);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      ...(faqs.length > 0 ? [faqPageJsonLd(faqs, url)] : []),
      organizationJsonLd(),
      breadcrumb([
        { name: tc('appName'), path: '' },
        { name: t('faq.title'), path: PATH },
      ]),
    ],
  };

  return (
    <>
      <JsonLd data={jsonLd} nonce={nonce} />
      <ContentPage
        title={t('faq.title')}
        dateLine={t('lastReview', { date: FAQ_LAST_REVIEW, version: FAQ_MANUAL_VERSION })}
        spanishOnlyNotice={locale !== 'es' ? t('spanishOnly') : undefined}
      >
        {faqs.length > 0 ? (
          <FaqGroups groups={groupFaqs(faqs)} />
        ) : (
          <EmptyContent message={t('faq.empty')} />
        )}
      </ContentPage>
    </>
  );
}
