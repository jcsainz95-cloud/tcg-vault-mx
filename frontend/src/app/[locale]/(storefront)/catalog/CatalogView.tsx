'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { StoreTabs } from '@/components/domain/StoreTabs';
import { getCatalog, getCatalogFacets, type CatalogFilters, type CatalogSort } from '@/lib/api';
import type { ListingDTO } from '@/types/contract';
import { useCart } from '@/lib/cart';
import { ListingCard } from '@/components/domain/ListingCard';
import { ShopFilters } from '@/components/domain/ShopFilters';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { CartAddedToast } from './CartAddedToast';

const SORTS: CatalogSort[] = ['newest', 'price_asc', 'price_desc'];

/**
 * Vitrina "Compra": inventario publicado con precio (DESIGN_SYSTEM §7.1/§7.16).
 *
 * 6a — Dirección 5a: los filtros son un índice tipográfico a la izquierda,
 * separado del grid por una regla de columna completa, y el grid pierde la caja:
 * cada pieza es arte, regla fina y datos. El carrito ya vive en el header del
 * sitio, así que la vitrina no lo repite.
 */
export function CatalogView() {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const tShop = useTranslations('shop');
  const cart = useCart();
  const [filters, setFilters] = useState<CatalogFilters>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  // Toast de confirmación al agregar (timestamp del último add; 0 = oculto).
  // El estado «En el carrito» del botón vive en ListingCard (zona compartida de
  // otro stream, sin prop para expresarlo): aquí el feedback es el toast.
  const [addedSignal, setAddedSignal] = useState(0);
  const dismissToast = useCallback(() => setAddedSignal(0), []);

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
    setAddedSignal(Date.now());
  }

  const sortControl = (
    <Select
      label={tShop('sortLabel')}
      placeholder="—"
      options={SORTS.map((s) => ({ value: s, label: tShop(`sort.${s}`) }))}
      value={filters.sort ?? ''}
      onChange={(e) => setFilters((f) => ({ ...f, sort: (e.target.value || undefined) as CatalogSort }))}
    />
  );

  const searchField = (
    <input
      type="search"
      aria-label={t('searchPlaceholder')}
      placeholder={t('searchPlaceholder')}
      value={filters.q ?? ''}
      onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value || undefined }))}
      className="w-full border-b border-border-strong bg-transparent pb-2.5 text-[13px] text-text outline-none placeholder:text-muted focus:border-text focus-visible:shadow-focus"
    />
  );

  return (
    <div>
      <StoreTabs />
      {/* Encabezado: el título en mincho manda; el orden se alinea a la línea base. */}
      <div className="gutter flex flex-col gap-6 pb-6 pt-10 sm:flex-row sm:items-end sm:justify-between lg:pt-[46px]">
        <div>
          <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('title')}</h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">{t('subtitle')}</p>
        </div>
        <div className="hidden sm:block sm:min-w-[200px] sm:text-right">{sortControl}</div>
      </div>

      {/* Acciones móviles: filtros y orden como dos rectángulos de regla. */}
      <div className="gutter flex gap-2.5 pb-4 lg:hidden">
        <Button variant="secondary" size="sm" className="flex-1" onClick={() => setSheetOpen(true)}>
          {tShop('filtersTitle')}
        </Button>
        <div className="flex-1 sm:hidden">{sortControl}</div>
      </div>

      <div className="grid border-t border-border lg:grid-cols-[270px_1fr]">
        {/* Índice de filtros (lg+) */}
        <aside className="hidden border-r border-border px-7 pb-16 pt-8 lg:block">
          <p className="eyebrow">{tShop('filtersTitle')}</p>
          <div className="mt-6">{searchField}</div>
          <div className="mt-8">
            <ShopFilters facets={facetsQuery.data} filters={filters} onChange={setFilters} />
          </div>
        </aside>

        <div className="min-w-0">
          {/* Conteo + filtros activos como marcas de regla, no como pastillas. */}
          <div className="gutter flex flex-wrap items-center gap-3 border-b border-border py-5">
            <p className="text-[13px] text-muted">{t('resultsCount', { count: total })}</p>
            {hasFilters && (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {activeChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => setFilters((f) => chip.remove(f))}
                    className="inline-flex items-center gap-1.5 border border-border-strong px-2.5 py-2 font-mono text-xs text-text hover:border-text"
                  >
                    <span lang={chip.lang}>{chip.label}</span>
                    <span aria-hidden>✕</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setFilters({})}
                  className="px-1 py-2 font-mono text-xs text-accent hover:text-text"
                >
                  {tc('clearFilters')}
                </button>
              </div>
            )}
          </div>

          <QueryState
            isLoading={catalogQuery.isLoading}
            isError={catalogQuery.isError}
            error={catalogQuery.error}
            onRetry={() => catalogQuery.refetch()}
            loading={
              <div className="gutter grid grid-cols-2 gap-5 py-9 sm:grid-cols-3 lg:gap-[34px] xl:grid-cols-4">
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
              <div className="gutter grid grid-cols-2 gap-5 pb-16 pt-9 sm:grid-cols-3 lg:gap-[34px] xl:grid-cols-4">
                {catalogQuery.data!.data.map((listing) => (
                  <ListingCard key={listing.inventoryItemId} listing={listing} onAdd={onAdd} />
                ))}
              </div>
            )}
          </QueryState>
        </div>
      </div>

      {/* Hoja de filtros (móvil) */}
      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title={tShop('filtersTitle')}>
        <div className="flex flex-col gap-6">
          {searchField}
          <ShopFilters facets={facetsQuery.data} filters={filters} onChange={setFilters} />
          <Button className="w-full" onClick={() => setSheetOpen(false)}>
            {tShop('applyFilters', { count: total })}
          </Button>
        </div>
      </Modal>

      <CartAddedToast signal={addedSignal} onDismiss={dismissToast} />
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
  if (filters.finish) {
    // v1.6-finish: chip del acabado activo (etiqueta cruda; la localizada vive en el panel de filtros).
    chips.push({ key: 'finish', label: filters.finish, remove: (f) => ({ ...f, finish: undefined }) });
  }
  if (filters.minPriceCents != null) {
    chips.push({ key: 'min', label: `≥ MX$${Math.round(filters.minPriceCents / 100)}`, remove: (f) => ({ ...f, minPriceCents: undefined }) });
  }
  if (filters.maxPriceCents != null) {
    chips.push({ key: 'max', label: `≤ MX$${Math.round(filters.maxPriceCents / 100)}`, remove: (f) => ({ ...f, maxPriceCents: undefined }) });
  }
  return chips;
}
