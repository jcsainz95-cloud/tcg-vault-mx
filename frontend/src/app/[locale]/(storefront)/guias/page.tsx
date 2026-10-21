import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import { NONCE_HEADER } from '@/security/csp';
import { organizationJsonLd, SITE_URL } from '@/lib/seo';
import {
  breadcrumb,
  contentCanonical,
  guideDescription,
  publishedGuides,
  webPageJsonLd,
} from '@/lib/seo-content';
import { ContentPage, EmptyContent } from '../_content/ContentPage';

/**
 * ⭐ §MKT tienda §E6 — índice `/guias` (brief v1 §2.5). Enlazado desde el pie. Cada guía es
 * `/guias/<slug>` con JSON-LD `Article`.
 */
export const revalidate = 3600;

const PATH = '/guias';

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
    title: `${tc('appName')} — ${t('guides.title')}`,
    description: t('guides.description'),
    alternates: { canonical: contentCanonical(PATH) },
  };
}

export default async function GuiasPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const [t, tc, nonce] = await Promise.all([
    getTranslations({ locale, namespace: 'seo' }),
    getTranslations({ locale, namespace: 'common' }),
    headers().then((h) => h.get(NONCE_HEADER) ?? undefined),
  ]);
  const guides = publishedGuides();
  const latest = guides.map((g) => g.datePublished).sort().at(-1);
  const url = contentCanonical(PATH);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      webPageJsonLd({ name: t('guides.title'), url, dateModified: latest ?? '' }),
      organizationJsonLd(),
      breadcrumb([
        { name: tc('appName'), path: '' },
        { name: t('guides.title'), path: PATH },
      ]),
    ],
  };

  return (
    <>
      <JsonLd data={jsonLd} nonce={nonce} />
      <ContentPage
        title={t('guides.title')}
        dateLine={latest ? t('guides.published', { date: latest }) : ''}
        spanishOnlyNotice={locale !== 'es' ? t('spanishOnly') : undefined}
      >
        {guides.length > 0 ? (
          <ul className="flex flex-col">
            {guides.map((g) => (
              <li key={g.slug} className="flex flex-col gap-2 border-t border-border py-5">
                <h2 className="text-h3 font-semibold">
                  <Link href={`/guias/${g.slug}`} className="hover:text-accent">
                    {g.headline}
                  </Link>
                </h2>
                <p className="text-sm leading-relaxed text-text/90">{guideDescription(g)}</p>
                <Link
                  href={`/guias/${g.slug}`}
                  lang={locale}
                  className="font-mono text-[11px] uppercase tracking-label text-text hover:text-accent"
                >
                  {t('guides.readGuide')}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyContent message={t('guides.empty')} />
        )}
      </ContentPage>
    </>
  );
}
