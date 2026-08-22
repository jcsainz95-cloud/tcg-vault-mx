'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getCatalog } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { CardImage } from '@/components/ui/CardImage';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryState } from '@/components/ui/QueryState';
import { Shelf } from '../_shared/Shelf';
import { StockBadge, stockVariantFromCount } from '../_shared/StockBadge';
import { PendingPriceLabel } from '../_shared/PendingPriceLabel';

/**
 * «Cartas gradeadas» (makeover 1a §6): 4 tejas con chip de grado (empresa + valor) REAL del
 * grupo. Vitrina: vacía ⇒ no se renderiza.
 *
 * v1.38-grouped-listings (P-30): la fuente (GET /catalog/cards) es AGRUPADA — cada teja es un
 * `GroupedListingDTO` con `stockCount` real (badge Último / N en stock). El `certNumber` es POR
 * SLAB (vive en units[] de la ficha), no a nivel de grupo, así que la vitrina ya no lo pinta.
 *
 * El link «Ver todas las gradeadas» lleva ?productType=graded: CatalogView inicializa
 * sus filtros desde la URL (parseUrlFilters), así que el deep-link aterriza filtrado.
 */
export function GradedShelf() {
  const t = useTranslations('home');
  const locale = useLocale() as AppLocale;

  const graded = useQuery({
    queryKey: ['catalog', { home: true, productType: 'graded' }],
    queryFn: () => getCatalog({ productType: 'graded', sort: 'price_desc', pageSize: 4 }),
    staleTime: 60_000,
  });
  const listings = (graded.data?.data ?? []).slice(0, 4);

  if (!graded.isLoading && !graded.isError && listings.length === 0) return null;

  return (
    <Shelf
      title={t('graded.title')}
      kicker={t('graded.companies')}
      subtitle={t('graded.subtitle')}
      subtitleClassName="mt-3 max-w-[540px]"
      className="border-t border-border"
      headerClassName="pt-10 lg:pt-11"
      viewAllHref="/catalog?productType=graded"
      viewAllLabel={t('graded.viewAll')}
    >
      {/* R3: error vía QueryState compartido; el wrapper aporta gutter solo en esa rama. */}
      <div className={graded.isError ? 'gutter pb-12 pt-6' : undefined}>
        <QueryState
          isLoading={graded.isLoading}
          isError={graded.isError}
          error={graded.error}
          onRetry={() => graded.refetch()}
          loading={
            <div className="gutter mt-6 grid grid-cols-2 gap-6 pb-12 lg:mt-7 lg:grid-cols-4 lg:gap-8 lg:pb-14">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[5/7] w-full" />
              ))}
            </div>
          }
        >
          <div className="gutter mt-6 grid grid-cols-2 gap-6 pb-12 lg:mt-7 lg:grid-cols-4 lg:gap-8 lg:pb-14">
            {listings.map((l) => (
              <Link key={l.representativeInventoryItemId} href={`/catalog/${l.card.id}`} className="block">
                <CardImage src={l.card.imageSmallUrl} alt={l.card.name} />
                <div className="mt-3.5 flex flex-wrap items-center gap-2">
                  <span className="tabular border border-text px-[7px] py-1 font-mono text-[10px] font-medium leading-none tracking-[0.1em] text-text">
                    {l.gradingCompany} {l.gradeValue}
                  </span>
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
                  <PendingPriceLabel className="mt-3 block" />
                )}
                <StockBadge variant={stockVariantFromCount(l.stockCount)} count={l.stockCount} className="mt-2" />
              </Link>
            ))}
          </div>
        </QueryState>
      </div>
    </Shelf>
  );
}
