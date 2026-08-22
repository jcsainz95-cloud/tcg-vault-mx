'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getSealedGroups } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

/**
 * «Producto sellado» (makeover 1a §5): 3 tejas horizontales sobre pozo surface-2.
 * GET /catalog/sealed SÍ agrega cantidad por grupo (availableCount), así que aquí el
 * «N en stock» / «Último» es real. Vitrina: vacía ⇒ no se renderiza.
 */
export function SealedShelf() {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;

  const sealed = useQuery({
    queryKey: ['sealed-groups', { home: true }],
    queryFn: () => getSealedGroups({ pageSize: 3 }),
    staleTime: 60_000,
  });
  const groups = (sealed.data?.data ?? []).slice(0, 3);

  if (!sealed.isLoading && !sealed.isError && groups.length === 0) return null;

  return (
    <section className="border-t border-border bg-surface-2" aria-label={t('sealed.title')}>
      <div className="gutter flex items-baseline justify-between gap-4 pb-5 pt-10 lg:pt-11">
        <h2 className="font-serif text-[22px] leading-tight text-text lg:text-[29px]">
          {t('sealed.title')}
        </h2>
        <Link
          href="/sellado"
          className="text-[11px] font-medium uppercase tracking-label text-muted hover:text-text"
        >
          {t('sealed.viewAll')}
        </Link>
      </div>

      {sealed.isError ? (
        <div className="gutter pb-12">
          <div className="rule-note py-1">
            <p className="text-sm font-medium text-accent">{tc('errorTitle')}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => sealed.refetch()}>
              {tc('retry')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="gutter grid gap-6 pb-12 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
          {sealed.isLoading &&
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
          {groups.map((g) => (
            <Link
              key={`${g.representativeItemId}:${g.sealedCondition}`}
              href={`/sellado/${g.representativeItemId}`}
              className="flex items-start gap-[18px] border-t border-border-strong pt-[18px]"
            >
              <div className="flex h-[88px] w-[88px] shrink-0 items-center justify-center bg-surface p-1.5">
                {g.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={g.imageUrl}
                    alt=""
                    aria-hidden
                    lang="en"
                    loading="lazy"
                    className="h-full w-full object-contain"
                  />
                )}
              </div>
              <div className="min-w-0">
                <p lang="en" className="font-serif text-base leading-[1.3] text-text">
                  {g.productName}
                </p>
                <p className="tabular mt-2.5 text-base font-medium leading-none text-text">
                  {formatMoneyCents(g.fromPriceCents, locale)}
                </p>
                <p
                  className={cn(
                    'mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em]',
                    g.availableCount === 1 ? 'text-muted' : 'text-success',
                  )}
                >
                  {g.availableCount === 1
                    ? t('sealed.last')
                    : t('sealed.inStock', { count: g.availableCount })}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
