import type { Metadata } from 'next';
import { headers } from 'next/headers';
import NextLink from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { AppLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import { NONCE_HEADER } from '@/security/csp';
import { RouteMessages } from '@/components/i18n/RouteMessages';
import { formatMoneyCents } from '@/lib/format';
import { loadShippingRuleForSSR } from '@/lib/catalog-ssr';
import { breadcrumbJsonLd, organizationJsonLd, routeMetadata, siteAbsoluteUrl } from '@/lib/seo';
import { brandEmail } from '@/lib/brand';
import {
  ABOUT_CITY,
  ABOUT_LAST_REVIEW,
  ABOUT_PATH,
  CONTACT_PHONE,
  INSTAGRAM_HANDLE,
  INSTAGRAM_URL,
  PUBLIC_CONTACT_EMAIL,
  telHref,
} from '@/lib/about';
import { resolveLegalEntity } from '../footer';

/**
 * DESIGN_SYSTEM MKT-CONV.4 (B2, criterios 944–946) — «Quiénes somos y contacto» en `/{es,en}/nosotros`. Página
 * estática de servidor (sin carga ni error propios): una columna `max-w-[720px]`, h1 serif, lead y tres bloques con
 * `dl` (etiqueta mono 11 muted | valor 15 px). ⛔ **Fila sin valor ⇒ no se pinta** (`Row` devuelve `null`; candado
 * L-7): hoy no hay razón social ni teléfono (HECHOS 2026-10-31), y sus filas no existen.
 *
 * Datos del dueño en `lib/about.ts`; textos en `messages/*.json` `about.*`. El párrafo «quién está detrás»
 * (`about.who.story`) es un texto mínimo factual hasta que marketing entregue el suyo (MKT-5 (a)): ciudad (HECHOS
 * 2026-10-31) y la revisión en mano, que dice `/preguntas` (`content/seo/faq.es.ts` P7 «Cada carta se revisa en mano al
 * entrar a la bóveda» y P8). Se sustituye cambiando SOLO esa clave. El envío sale de la regla pública viva
 * (`GET /checkout/shipping-rule`): sin ella a tiempo, la fila se omite (ningún importe a mano).
 */
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ locale: AppLocale }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'about' });
  return routeMetadata({ locale, path: ABOUT_PATH, title: `${t('title')} · TCG HUNT`, description: t('description') });
}

function Row({ label, children, testId }: { label: string; children?: React.ReactNode; testId?: string }) {
  if (children == null || children === '' || children === false) return null;
  return (
    <div data-about-row={testId} className="flex flex-col gap-1 py-3 md:grid md:grid-cols-[200px_1fr] md:gap-4">
      <dt className="font-mono text-[11px] uppercase tracking-label text-muted md:pt-1">{label}</dt>
      <dd className="text-[15px] leading-[1.6] text-text">{children}</dd>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{title}</h2>
      <dl className="mt-2">{children}</dl>
    </section>
  );
}

const LINK = 'text-text underline underline-offset-4 hover:text-accent';

export default async function AboutPage({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const { locale } = await params;
  const [t, tc, tf, nonce, rule] = await Promise.all([
    getTranslations({ locale, namespace: 'about' }),
    getTranslations({ locale, namespace: 'common' }),
    getTranslations({ locale, namespace: 'checkout' }),
    headers().then((h) => h.get(NONCE_HEADER) ?? undefined),
    loadShippingRuleForSSR(),
  ]);
  const legalEntity = resolveLegalEntity(tc('footer.legalEntity'));
  const url = siteAbsoluteUrl(`/${locale}${ABOUT_PATH}`);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'AboutPage', name: t('title'), url, inLanguage: locale === 'en' ? 'en' : 'es-MX', dateModified: ABOUT_LAST_REVIEW },
      organizationJsonLd(),
      breadcrumbJsonLd([
        { name: tc('appName'), url: siteAbsoluteUrl(`/${locale}`) },
        { name: t('title'), url },
      ]),
    ],
  };
  const shipping = rule
    ? t('buy.shippingValue', {
        cards: formatMoneyCents(rule.cardsOnlyFeeCents, locale),
        sealed: formatMoneyCents(rule.sealedFeeCents, locale),
        freeFrom: formatMoneyCents(rule.freeFromCents, locale),
      })
    : null;

  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <>
        <JsonLd data={jsonLd} nonce={nonce} />
        <article className="gutter mx-auto flex max-w-[720px] flex-col gap-8 py-10 lg:py-14">
          <header className="flex flex-col gap-4">
            <h1 className="font-serif text-[32px] leading-[1.05] text-text lg:text-[46px]">{t('title')}</h1>
            <p className="text-[15px] leading-[1.7] text-muted">{t('lead')}</p>
          </header>

          <Block title={t('who.title')}>
            <p data-about-row="story" className="py-3 text-[15px] leading-[1.6] text-text">
              {t('who.story')}
            </p>
            <Row label={t('who.legalEntity')} testId="legal-entity">
              {legalEntity}
            </Row>
            <Row label={t('who.city')} testId="city">
              {ABOUT_CITY[locale]}
            </Row>
          </Block>

          <Block title={t('buy.title')}>
            <Row label={t('buy.account')} testId="account">
              {t('buy.accountValue')}
            </Row>
            <Row label={t('buy.payment')} testId="payment">
              {t('buy.paymentValue')}
            </Row>
            <Row label={t('buy.shipping')} testId="shipping">
              {shipping}
            </Row>
            <Row label={t('buy.delivery')} testId="delivery">
              {t('buy.deliveryValue')}
            </Row>
            <Row label={t('buy.guarantee')} testId="guarantee">
              {tf('refundPromise')}{' '}
              <Link href="/terminos" className={LINK}>
                {t('buy.guaranteeTerms')}
              </Link>
            </Row>
            <Row label={t('buy.invoice')} testId="invoice">
              {t('buy.invoiceValue', { email: brandEmail('facturacion') })}
            </Row>
          </Block>

          <Block title={t('contact.title')}>
            <Row label={t('contact.email')} testId="email">
              {PUBLIC_CONTACT_EMAIL && (
                <a href={`mailto:${PUBLIC_CONTACT_EMAIL}`} className={LINK}>
                  {PUBLIC_CONTACT_EMAIL}
                </a>
              )}
            </Row>
            <Row label={t('contact.instagram')} testId="instagram">
              <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
                {INSTAGRAM_HANDLE}
              </a>
            </Row>
            {/* Teléfono: preparado; sin número del dueño (`CONTACT_PHONE` vacío) la fila no existe. */}
            <Row label={t('contact.phone')} testId="phone">
              {CONTACT_PHONE && (
                <>
                  <a href={telHref(CONTACT_PHONE)} className={LINK}>
                    {CONTACT_PHONE}
                  </a>
                  <span className="mt-1 block text-[13px] text-muted">{t('contact.phoneNote')}</span>
                </>
              )}
            </Row>
            <Row label={t('contact.cardShow')} testId="card-show">
              {/* `/card-show` vive fuera del i18n (HECHOS 2026-10-31): enlace de Next sin prefijo de idioma. */}
              <NextLink href="/card-show" className={LINK}>
                {t('contact.cardShowLink')}
              </NextLink>
            </Row>
          </Block>
        </article>
      </>
    </RouteMessages>
  );
}
