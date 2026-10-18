import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import { NONCE_HEADER } from '@/security/csp';
import { organizationJsonLd, SITE_URL } from '@/lib/seo';
import {
  articleJsonLd,
  breadcrumb,
  contentCanonical,
  faqAnswer,
  guideDescription,
  publishedGuides,
} from '@/lib/seo-content';
import { guideBySlug, type Guide } from '@/content/seo/guides.es';
import { ContentPage } from '../../_content/ContentPage';

/**
 * ⭐ §MKT tienda §E6 — una guía (`/guias/<slug>`), JSON-LD `Article` (v1 §2.5: `headline`,
 * `datePublished`, `author` = Organization TCG HUNT) + `BreadcrumbList`. Solo los 4 slugs de
 * `content/seo/guides.es.ts`; cualquier otro ⇒ 404 (`dynamicParams = false`).
 */
export const dynamicParams = false;
export const revalidate = 3600;

export function generateStaticParams() {
  return publishedGuides().map((g) => ({ slug: g.slug }));
}

function liveGuide(slug: string): Guide | undefined {
  const g = guideBySlug(slug);
  return g && publishedGuides().some((p) => p.slug === g.slug) ? g : undefined;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const guide = liveGuide(slug);
  if (!guide) return {};
  const tc = await getTranslations({ locale, namespace: 'common' });
  const canonical = contentCanonical(`/guias/${guide.slug}`);
  const description = guideDescription(guide);
  return {
    metadataBase: new URL(SITE_URL),
    title: `${guide.headline} | ${tc('appName')}`,
    description,
    alternates: { canonical },
    openGraph: { type: 'article', siteName: 'TCG HUNT', title: guide.headline, description, url: canonical },
  };
}

export default async function GuiaPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const guide = liveGuide(slug);
  if (!guide) notFound();
  const [t, tc, nonce] = await Promise.all([
    getTranslations({ locale, namespace: 'seo' }),
    getTranslations({ locale, namespace: 'common' }),
    headers().then((h) => h.get(NONCE_HEADER) ?? undefined),
  ]);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      articleJsonLd(guide),
      organizationJsonLd(),
      breadcrumb([
        { name: tc('appName'), path: '' },
        { name: t('guides.title'), path: '/guias' },
        { name: guide.headline, path: `/guias/${guide.slug}` },
      ]),
    ],
  };
  const cta =
    guide.cta === 'buylist'
      ? { href: '/buylist', label: t('guides.ctaBuylist') }
      : { href: '/catalog', label: t('guides.ctaCatalog') };

  return (
    <>
      <JsonLd data={jsonLd} nonce={nonce} />
      <ContentPage
        title={guide.headline}
        dateLine={t('guides.published', { date: guide.datePublished })}
        spanishOnlyNotice={locale !== 'es' ? t('spanishOnly') : undefined}
      >
        <div className="flex flex-col gap-4 border-t border-border pt-5">
          {guide.blocks.map((b, i) => {
            if (b.kind === 'ol') {
              return (
                <ol
                  key={i}
                  className="flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed text-text/90"
                >
                  {(b.items ?? []).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              );
            }
            const text = b.kind === 'faq' ? (b.faqId ? faqAnswer(b.faqId) : undefined) : b.text;
            return text ? (
              <p key={i} className="text-sm leading-relaxed text-text/90">
                {text}
              </p>
            ) : null;
          })}
        </div>
        <p className="border-t border-border pt-5">
          <Link
            href={cta.href}
            lang={locale}
            className="inline-flex min-h-[44px] items-center bg-primary px-6 font-mono text-xs uppercase tracking-label text-primary-fg hover:bg-accent"
          >
            {cta.label}
          </Link>
        </p>
      </ContentPage>
    </>
  );
}
