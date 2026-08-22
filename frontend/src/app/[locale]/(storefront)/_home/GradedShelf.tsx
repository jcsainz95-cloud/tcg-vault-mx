'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getCatalog } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { CardImage } from '@/components/ui/CardImage';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';

/**
 * «Cartas gradeadas» (makeover 1a §6): 4 tejas con chip de grado (empresa + valor) y
 * número de certificado REALES del listing. Vitrina: vacía ⇒ no se renderiza.
 *
 * El link «Ver todas las gradeadas» lleva ?productType=graded: /catalog aún no
 * inicializa filtros desde la URL (CatalogView, módulo catálogo) — queda documentado
 * en FRONTEND_NOTES como seguimiento para el dueño de ese módulo.
 */
export function GradedShelf() {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;

  const graded = useQuery({
    queryKey: ['catalog', { home: true, productType: 'graded' }],
    queryFn: () => getCatalog({ productType: 'graded', sort: 'price_desc', pageSize: 4 }),
    staleTime: 60_000,
  });
  const listings = (graded.data?.data ?? []).filter((l) => l.sellable).slice(0, 4);

  if (!graded.isLoading && !graded.isError && listings.length === 0) return null;

  return (
    <section className="border-t border-border" aria-label={t('graded.title')}>
      <div className="gutter flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 pt-10 lg:pt-11">
        <div className="flex items-baseline gap-4">
          <h2 className="font-serif text-[22px] leading-tight text-text lg:text-[29px]">
            {t('graded.title')}
          </h2>
          <span className="eyebrow">{t('graded.companies')}</span>
        </div>
        <Link
          href="/catalog?productType=graded"
          className="text-[11px] font-medium uppercase tracking-label text-muted hover:text-text"
        >
          {t('graded.viewAll')}
        </Link>
      </div>
      <p className="gutter mt-3 max-w-[540px] text-sm leading-[1.6] text-muted">
        {t('graded.subtitle')}
      </p>

      {graded.isError ? (
        <div className="gutter pb-12 pt-6">
          <div className="rule-note py-1">
            <p className="text-sm font-medium text-accent">{tc('errorTitle')}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => graded.refetch()}>
              {tc('retry')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="gutter mt-6 grid grid-cols-2 gap-6 pb-12 lg:mt-7 lg:grid-cols-4 lg:gap-8 lg:pb-14">
          {graded.isLoading &&
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[5/7] w-full" />
            ))}
          {listings.map((l) => (
            <Link key={l.inventoryItemId} href={`/catalog/${l.card.id}`} className="block">
              <CardImage src={l.card.imageSmallUrl} alt={l.card.name} />
              <div className="mt-3.5 flex flex-wrap items-center gap-2">
                <span className="tabular border border-text px-[7px] py-1 font-mono text-[10px] font-medium leading-none tracking-[0.1em] text-text">
                  {l.gradingCompany} {l.gradeValue}
                </span>
                {l.certNumber && (
                  <span className="tabular font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
                    {t('graded.cert', { num: l.certNumber })}
                  </span>
                )}
              </div>
              <p lang="en" className="mt-3 font-serif text-base leading-[1.3] text-text">
                {l.card.name}
              </p>
              <p lang="en" className="mt-1.5 font-mono text-[11px] leading-snug text-muted">
                {l.card.setName} · #{l.card.number}
              </p>
              {l.salePriceCents != null ? (
                <p className="tabular mt-3 text-[17px] font-medium leading-none text-text">
                  {formatMoneyCents(l.salePriceCents, locale)}
                </p>
              ) : (
                <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                  {t('pricePending')}
                </p>
              )}
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
                {t('lastOne')}
              </p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
