'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ShoppingCart, SlidersHorizontal, X } from 'lucide-react';
import { getCatalog, getCatalogFacets, type CatalogFilters, type CatalogSort } from '@/lib/api';
import type { ListingDTO } from '@/types/contract';
import { useCart } from '@/lib/cart';
import { Link } from '@/i18n/navigation';
import { ListingCard } from '@/components/domain/ListingCard';
import { ShopFilters } from '@/components/domain/ShopFilters';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';

const SORTS: CatalogSort[] = ['newest', 'price_asc', 'price_desc'];

/** Vitrina "Compra": inventario publicado con precio (DESIGN_SYSTEM §7.1/§7.16). */
export function CatalogView() {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const tShop = useTranslations('shop');
  const cart = useCart();
  const [filters, setFilters] = useState<CatalogFilters>({});
  const [sheetOpen, setSheetOpen] = useState(false);

  const facetsQuery = useQuery({ queryKey: ['facets'], queryFn: getCatalogFacets });
  const catalogQuery = useQuery({
    queryKey: ['catalog', filters],
    queryFn: () => getCatalog(filters),
  });

  const activeChips = useMemo(() => buildChips(filters), [filters]);
  const hasFilters = activeChips.length > 0;
  const total = catalogQuery.data?.total ?? 0;

  function onAdd(listing: ListingDTO) {
    cart.add(listing.inventoryItemId);
  }

  const filtersPanel = (
    <ShopFilters facets={facetsQuery.data} filters={filters} onChange={setFilters} />
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-h1 font-bold">{t('title')}</h1>
          <Link
            href="/checkout"
            aria-label={tc('total')}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border-strong px-4 text-sm font-medium hover:bg-surface-2"
          >
            <ShoppingCart size={18} aria-hidden />
            <span className="tabular">{cart.count}</span>
          </Link>
        </div>
        <p className="text-sm text-muted">{t('subtitle')}</p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Panel lateral de filtros (lg+) */}
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-20 flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
            <h2 className="text-h3 font-semibold">{tShop('filtersTitle')}</h2>
            <Input
              label={t('searchPlaceholder')}
              placeholder={t('searchPlaceholder')}
              value={filters.q ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value || undefined }))}
            />
            {filtersPanel}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Barra superior: contador, filtros móvil, orden */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="lg:hidden"
                onClick={() => setSheetOpen(true)}
              >
                <SlidersHorizontal size={16} aria-hidden /> {tShop('openFilters')}
              </Button>
              <p className="text-sm text-muted">{t('resultsCount', { count: total })}</p>
            </div>
            <div className="w-48">
              <Select
                label={tShop('sortLabel')}
                placeholder="—"
                options={SORTS.map((s) => ({ value: s, label: tShop(`sort.${s}`) }))}
                value={filters.sort ?? ''}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, sort: (e.target.value || undefined) as CatalogSort }))
                }
              />
            </div>
          </div>

          {/* Chips de filtros activos (removibles) */}
          {hasFilters && (
            <div className="flex flex-wrap items-center gap-2">
              {activeChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setFilters((f) => chip.remove(f))}
                  className="inline-flex items-center gap-1 rounded-full border border-border-strong bg-surface-2 px-2 py-1 text-xs text-text hover:bg-surface"
                >
                  <span lang={chip.lang}>{chip.label}</span>
                  <X size={12} aria-hidden />
                </button>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
                {tc('clearFilters')}
              </Button>
            </div>
          )}

          <QueryState
            isLoading={catalogQuery.isLoading}
            isError={catalogQuery.isError}
            error={catalogQuery.error}
            onRetry={() => catalogQuery.refetch()}
            loading={
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
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
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
                {catalogQuery.data!.data.map((listing) => (
                  <ListingCard key={listing.inventoryItemId} listing={listing} onAdd={onAdd} />
                ))}
              </div>
            )}
          </QueryState>
        </div>
      </div>

      {/* Bottom sheet de filtros (móvil) */}
      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title={tShop('filtersTitle')}>
        <div className="flex flex-col gap-4">
          <Input
            label={t('searchPlaceholder')}
            placeholder={t('searchPlaceholder')}
            value={filters.q ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value || undefined }))}
          />
          {filtersPanel}
          <Button className="w-full" onClick={() => setSheetOpen(false)}>
            {tShop('applyFilters', { count: total })}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// Construye los chips removibles del estado de filtros activo.
interface Chip {
  key: string;
  label: string;
  lang?: string;
  remove: (f: CatalogFilters) => CatalogFilters;
}

function buildChips(filters: CatalogFilters): Chip[] {
  const chips: Chip[] = [];
  if (filters.q) {
    chips.push({ key: 'q', label: `"${filters.q}"`, remove: (f) => ({ ...f, q: undefined }) });
  }
  if (filters.setId) {
    chips.push({ key: 'set', label: filters.setId, lang: 'en', remove: (f) => ({ ...f, setId: undefined }) });
  }
  for (const r of filters.rarity ?? []) {
    chips.push({
      key: `r-${r}`,
      label: r,
      lang: 'en',
      remove: (f) => ({ ...f, rarity: (f.rarity ?? []).filter((x) => x !== r).length ? (f.rarity ?? []).filter((x) => x !== r) : undefined }),
    });
  }
  if (filters.productType) {
    chips.push({
      key: 'type',
      label: filters.productType,
      remove: (f) => ({ ...f, productType: undefined, sealedSubtype: undefined }),
    });
  }
  if (filters.sealedSubtype) {
    chips.push({ key: 'subtype', label: filters.sealedSubtype, remove: (f) => ({ ...f, sealedSubtype: undefined }) });
  }
  if (filters.minPriceCents != null) {
    chips.push({ key: 'min', label: `≥ MX$${Math.round(filters.minPriceCents / 100)}`, remove: (f) => ({ ...f, minPriceCents: undefined }) });
  }
  if (filters.maxPriceCents != null) {
    chips.push({ key: 'max', label: `≤ MX$${Math.round(filters.maxPriceCents / 100)}`, remove: (f) => ({ ...f, maxPriceCents: undefined }) });
  }
  return chips;
}
