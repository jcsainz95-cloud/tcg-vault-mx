'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getSealedGroups } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryState } from '@/components/ui/QueryState';
import { Shelf } from '../_shared/Shelf';
import { StockBadge, stockVariantFromCount } from '../_shared/StockBadge';

/**
 * «Producto sellado» (makeover 1a §5): 3 tejas horizontales sobre pozo surface-2.
 * GET /catalog/sealed SÍ agrega cantidad por grupo (availableCount), así que aquí el
 * «N en stock» / «Último» es real (StockBadge §20.6 con conteo del backend).
 * Vitrina: vacía ⇒ no se renderiza.
 */
export function SealedShelf() {
  const t = useTranslations('home');
  const locale = useLocale() as AppLocale;

  const sealed = useQuery({
    queryKey: ['sealed-groups', { home: true }],
    queryFn: () => getSealedGroups({ pageSize: 3 }),
    staleTime: 60_000,
  });
  const groups = (sealed.data?.data ?? []).slice(0, 3);

  if (!sealed.isLoading && !sealed.isError && groups.length === 0) return null;

  return (
    <Shelf
      title={t('sealed.title')}
      className="border-t border-border bg-surface-2"
      headerClassName="pb-5 pt-10 lg:pt-11"
      viewAllHref="/sellado"
      viewAllLabel={t('sealed.viewAll')}
    >
      {/* R3: error vía QueryState compartido; el wrapper aporta gutter solo en esa rama. */}
      <div className={sealed.isError ? 'gutter pb-12' : undefined}>
        <QueryState
          isLoading={sealed.isLoading}
          isError={sealed.isError}
          error={sealed.error}
          onRetry={() => sealed.refetch()}
          loading={
            <div className="gutter grid gap-6 pb-12 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full" />
              ))}
            </div>
          }
        >
          <div className="gutter grid gap-6 pb-12 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
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
                  <StockBadge
                    variant={stockVariantFromCount(g.availableCount)}
                    count={g.availableCount}
                    className="mt-1.5"
                  />
                </div>
              </Link>
            ))}
          </div>
        </QueryState>
      </div>
    </Shelf>
  );
}
