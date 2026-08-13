'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ShoppingCart } from 'lucide-react';
import { getCatalog, getSets, type CatalogFilters } from '@/lib/api';
import type { ListingDTO, ProductType, RawCondition } from '@/types/contract';
import { useCart } from '@/lib/cart';
import { Link } from '@/i18n/navigation';
import { ListingCard } from '@/components/domain/ListingCard';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';

const PRODUCT_TYPES: ProductType[] = ['graded', 'sealed', 'raw'];
const CONDITIONS: RawCondition[] = ['NM', 'LP', 'MP', 'HP', 'DMG'];

export function CatalogView() {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const tp = useTranslations('card.productType');
  const cart = useCart();
  const [filters, setFilters] = useState<CatalogFilters>({});

  const setsQuery = useQuery({ queryKey: ['sets'], queryFn: getSets });
  const catalogQuery = useQuery({
    queryKey: ['catalog', filters],
    queryFn: () => getCatalog(filters),
  });

  const rarities = useMemo(() => {
    const set = new Set((catalogQuery.data?.data ?? []).map((l) => l.card.rarity));
    return Array.from(set);
  }, [catalogQuery.data]);

  const hasFilters = Object.values(filters).some((v) => v !== undefined && v !== '');

  function onAdd(listing: ListingDTO) {
    cart.add(listing.inventoryItemId);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-bold">{t('title')}</h1>
        <Link
          href="/checkout"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border-strong px-4 text-sm font-medium hover:bg-surface-2"
        >
          <ShoppingCart size={18} aria-hidden />
          <span className="tabular">{cart.count}</span>
        </Link>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Input
          label={t('searchPlaceholder')}
          placeholder={t('searchPlaceholder')}
          value={filters.q ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        />
        <Select
          label={t('filterSet')}
          placeholder="—"
          options={(setsQuery.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          value={filters.setId ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, setId: e.target.value || undefined }))}
        />
        <Select
          label={t('filterRarity')}
          placeholder="—"
          options={rarities.map((r) => ({ value: r, label: r }))}
          value={filters.rarity ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, rarity: e.target.value || undefined }))}
        />
        <Select
          label={t('filterType')}
          placeholder="—"
          options={PRODUCT_TYPES.map((pt) => ({ value: pt, label: tp(pt) }))}
          value={filters.productType ?? ''}
          onChange={(e) =>
            setFilters((f) => ({ ...f, productType: (e.target.value || undefined) as ProductType }))
          }
        />
        <Select
          label={t('filterCondition')}
          placeholder="—"
          options={CONDITIONS.map((c) => ({ value: c, label: c }))}
          value={filters.condition ?? ''}
          onChange={(e) =>
            setFilters((f) => ({ ...f, condition: (e.target.value || undefined) as RawCondition }))
          }
        />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {t('resultsCount', { count: catalogQuery.data?.total ?? 0 })}
        </p>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
            {tc('clearFilters')}
          </Button>
        )}
      </div>

      <QueryState
        isLoading={catalogQuery.isLoading}
        isError={catalogQuery.isError}
        error={catalogQuery.error}
        onRetry={() => catalogQuery.refetch()}
        loading={
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        }
      >
        {(catalogQuery.data?.data.length ?? 0) === 0 ? (
          <EmptyState
            title={t('emptyTitle')}
            body={t('emptyBody')}
            action={
              hasFilters && (
                <Button variant="secondary" onClick={() => setFilters({})}>
                  {tc('clearFilters')}
                </Button>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {catalogQuery.data!.data.map((listing) => (
              <ListingCard key={listing.inventoryItemId} listing={listing} onAdd={onAdd} />
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}
