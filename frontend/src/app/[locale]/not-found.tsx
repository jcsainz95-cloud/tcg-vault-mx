import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/**
 * C3 (criterio 951) — la página 404 de la tienda, con SU título («Página no encontrada · TCG HUNT») y no el de la
 * portada que heredaba del layout. La sirve todo `notFound()` bajo `[locale]`: la ficha de carta o de sellado que no
 * existe (`DETAIL_NOT_FOUND`), una guía retirada y el comodín `[...rest]`. Next añade `noindex` solo.
 *
 * Next resuelve los metadatos de la 404 con este módulo (`errorConvention: 'not-found'`). Sin `params`: el idioma sale
 * de la petición (`i18n/request.ts`). Componente de servidor, sin estado de carga ni error propios.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notFoundPage');
  return { title: t('metaTitle'), robots: { index: false, follow: true } };
}

export default async function LocaleNotFound() {
  const t = await getTranslations('notFoundPage');
  return (
    <section className="gutter mx-auto flex max-w-[720px] flex-col gap-4 py-16 lg:py-24">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">404</p>
      <h1 className="font-serif text-[32px] leading-[1.05] text-text lg:text-[46px]">{t('title')}</h1>
      <p className="text-[15px] leading-[1.7] text-muted">{t('body')}</p>
      <p>
        <Link href="/catalog" className="text-[15px] text-text underline underline-offset-4 hover:text-accent">
          {t('cta')}
        </Link>
      </p>
    </section>
  );
}
