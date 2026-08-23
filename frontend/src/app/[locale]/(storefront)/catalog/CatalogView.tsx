'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import type { ReadonlyURLSearchParams } from 'next/navigation';
import { StoreTabs } from '@/components/domain/StoreTabs';
import { getCatalog, getCatalogFacets, type CatalogFilters, type CatalogSort } from '@/lib/api';
import type { Finish, GroupedListingDTO, SealedSubtype } from '@/types/contract';
import { FINISH_ORDER } from '@/lib/finish';
import { useCart } from '@/lib/cart';
import { useRouter } from '@/i18n/navigation';
import { ShopFilters } from '@/components/domain/ShopFilters';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { CartAddedToast } from './CartAddedToast';
import { CatalogTile } from './CatalogTile';
import { Paginator } from '../_shared/Paginator';

const SORTS: CatalogSort[] = ['newest', 'price_asc', 'price_desc'];
/** pageSize del contrato (§2, default del backend); solo para el fallback del total de páginas. */
const DEFAULT_PAGE_SIZE = 20;

/**
 * Vitrina «Comprar»: inventario publicado con precio (DESIGN_SYSTEM §7.1/§7.16).
 *
 * Makeover 1a «Conservadora» (artboard 2a): eyebrow «Catálogo · MXN sin IVA» +
 * título en mincho con el conteo de piezas en mono a la derecha; pestañas
 * Cartas sueltas · Producto sellado · Gradeadas (StoreTabs); índice de filtros
 * de 252px separado por regla de columna completa; barra de resultados con
 * chips removibles y orden; grid de tejas 5/7 (CatalogTile, «Queda 1» literal)
 * y paginador sobrio sincronizado con los filtros (el backend pagina a 20).
 *
 * La pestaña «Gradeadas» es ?type=graded: aquí se lee el parámetro y se
 * sincroniza con filters.productType (y viceversa al cambiarlo en el panel).
 */
export function CatalogView() {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const tShop = useTranslations('shop');
  const cart = useCart();
  const router = useRouter();
  const searchParams = useSearchParams();
  // La pestaña Gradeadas usa ?type=graded; los enlaces del Home usan ?productType=graded.
  const gradedTab =
    searchParams?.get('type') === 'graded' || searchParams?.get('productType') === 'graded';

  // Los filtros se inicializan desde la URL (enlaces del Home: ?setId=, ?productType=…).
  const [filters, setFilters] = useState<CatalogFilters>(() => parseUrlFilters(searchParams));
  // R5: el input de búsqueda es estado propio INMEDIATO (UX responsiva) y solo su
  // valor DEBOUNCED entra a los filtros/queryKey — sin un fetch por pulsación
  // (mismo patrón P-5 de useDebouncedValue que HomeQuoter/M3).
  const [searchTerm, setSearchTerm] = useState<string>(() => parseUrlFilters(searchParams).q ?? '');
  const debouncedTerm = useDebouncedValue(searchTerm, 300);
  useEffect(() => {
    const q = debouncedTerm.trim() ? debouncedTerm : undefined;
    // Cambio real de término ⇒ cambia el universo del resultado: resetea página.
    setFilters((f) => ((f.q ?? '') === (q ?? '') ? f : { ...f, q, page: undefined }));
  }, [debouncedTerm]);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Toast de confirmación al agregar (timestamp del último add; 0 = oculto).
  // N-17: además del toast, cada teja refleja «En el carrito» derivado del store.
  const [addedSignal, setAddedSignal] = useState(0);
  const dismissToast = useCallback(() => setAddedSignal(0), []);
  // Ancla del scroll al paginar: la barra de resultados, no el tope de la página.
  const resultsRef = useRef<HTMLDivElement>(null);

  // URL → filtros: navegar entre pestañas (Sueltas ↔ Gradeadas), back/forward o
  // enlaces internos con query MERGEA los filtros presentes en la URL sobre el
  // estado (sin borrar lo elegido en el panel) y retira `graded` al salir de la
  // pestaña. El ref evita re-aplicar en renders sin cambio real de URL (p. ej.
  // tras el router.replace de updateFilters, que ya dejó el estado correcto).
  const urlKey = searchParams?.toString() ?? '';
  const prevUrlKey = useRef(urlKey);
  useEffect(() => {
    if (prevUrlKey.current === urlKey) return;
    prevUrlKey.current = urlKey;
    const fromUrl = parseUrlFilters(searchParams);
    // Un q que llega por URL también debe reflejarse en el input (fuente inmediata).
    if (fromUrl.q != null) setSearchTerm(fromUrl.q);
    setFilters((f) => {
      const next: CatalogFilters = { ...f, ...fromUrl, page: undefined };
      if (!gradedTab && f.productType === 'graded' && fromUrl.productType == null)
        next.productType = undefined;
      if (next.productType !== 'sealed') next.sealedSubtype = undefined;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);

  /**
   * Todo cambio de filtro u orden pasa por aquí: resetea la página (el
   * resultado cambia de universo) y mantiene la URL de la pestaña Gradeadas
   * coherente cuando el tipo cambia desde el panel o los chips.
   */
  const updateFilters = useCallback(
    (next: CatalogFilters) => {
      // Si el caller cambió `q` explícitamente (chip «✕», limpiar filtros), el input
      // se sincroniza; si `q` viene igual (cambio de orden/facetas), el input no se
      // toca para no pisar un término aún sin debouncear.
      if ((next.q ?? '') !== (filters.q ?? '')) setSearchTerm(next.q ?? '');
      setFilters({ ...next, page: undefined });
      if (gradedTab && next.productType !== 'graded') router.replace('/catalog');
      else if (!gradedTab && next.productType === 'graded') router.replace('/catalog?type=graded');
    },
    [filters.q, gradedTab, router],
  );

  const facetsQuery = useQuery({ queryKey: ['facets'], queryFn: getCatalogFacets });
  const catalogQuery = useQuery({
    queryKey: ['catalog', filters],
    queryFn: () => getCatalog(filters),
    // R5: paginar/filtrar no desmonta la grilla — se sigue mostrando la página
    // anterior mientras llega la nueva (isLoading solo en el primer fetch).
    placeholderData: keepPreviousData,
  });

  const activeChips = useMemo(
    // Las facetas dan el nombre legible del set para el chip (QA-1).
    () => buildChips(filters, facetsQuery.data?.sets),
    [filters, facetsQuery.data?.sets],
  );
  const hasFilters = activeChips.length > 0;
  const total = catalogQuery.data?.total ?? 0;
  const page = filters.page ?? 1;
  const totalPages = Math.max(
    1,
    Math.ceil(total / (catalogQuery.data?.pageSize ?? DEFAULT_PAGE_SIZE)),
  );

  // v1.38-grouped-listings (P-30): la teja es un GRUPO; el add-to-cart de 1 usa la pieza más barata
  // (representativeInventoryItemId). El carrito sigue siendo por-pieza (deduplicado por id).
  function onAdd(group: GroupedListingDTO) {
    cart.add(group.representativeInventoryItemId);
    setAddedSignal(Date.now());
  }

  function goToPage(p: number) {
    setFilters((f) => ({ ...f, page: p <= 1 ? undefined : p }));
    // jsdom no implementa scrollIntoView; el guard evita romper los tests.
    resultsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  const sortControl = (
    <Select
      label={tShop('sortLabel')}
      placeholder="—"
      options={SORTS.map((s) => ({ value: s, label: tShop(`sort.${s}`) }))}
      value={filters.sort ?? ''}
      onChange={(e) => updateFilters({ ...filters, sort: (e.target.value || undefined) as CatalogSort })}
    />
  );

  const searchField = (
    <input
      type="search"
      aria-label={t('searchPlaceholder')}
      placeholder={t('searchPlaceholder')}
      value={searchTerm}
      // R5: solo actualiza el estado inmediato; el fetch lo dispara el valor debounced.
      onChange={(e) => setSearchTerm(e.target.value)}
      className="w-full border-b border-border-strong bg-transparent pb-2.5 text-[13px] text-text outline-none placeholder:text-muted focus:border-text focus-visible:shadow-focus"
    />
  );

  return (
    <div>
      {/* Encabezado (artboard 2a): eyebrow · título mincho · conteo mono a la línea base. */}
      <div className="gutter flex flex-col gap-4 pb-6 pt-9 sm:flex-row sm:items-end sm:justify-between lg:pt-10">
        <div>
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1 className="mt-3 font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">
            {t('title')}
          </h1>
        </div>
        <p className="tabular font-mono text-[11px] leading-none text-muted">
          {t('piecesAvailable', { count: total })}
        </p>
      </div>

      <StoreTabs />

      {/* Acciones móviles: filtros (con conteo activo en rojo) y orden. */}
      <div className="gutter flex items-end gap-2.5 py-4 lg:hidden">
        <Button variant="secondary" size="sm" className="flex-1" onClick={() => setSheetOpen(true)}>
          {tShop('filtersTitle')}
          {hasFilters && (
            <span className="tabular font-mono text-accent" aria-hidden>
              {activeChips.length}
            </span>
          )}
        </Button>
        <div className="flex-1">{sortControl}</div>
      </div>

      <div className="grid border-t border-border lg:grid-cols-[252px_1fr] lg:border-t-0">
        {/* Índice de filtros (lg+): 252px, regla de columna completa. */}
        <aside className="hidden border-r border-border px-6 pb-16 pt-7 lg:block">
          <div className="flex items-baseline justify-between">
            <p className="eyebrow">{tShop('filtersTitle')}</p>
            {hasFilters && (
              <button
                type="button"
                onClick={() => updateFilters({})}
                className="font-mono text-[10px] uppercase tracking-[0.1em] text-accent hover:text-text"
              >
                {tc('clearFilters')}
              </button>
            )}
          </div>
          <div className="mt-6">{searchField}</div>
          <ShopFilters facets={facetsQuery.data} filters={filters} onChange={updateFilters} />
        </aside>

        <div className="min-w-0">
          {/* Barra de resultados: conteo mono + chips removibles + orden (lg). */}
          <div
            ref={resultsRef}
            className="gutter flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border py-4"
          >
            <p className="tabular font-mono text-[11px] text-muted">
              {t('resultsCount', { count: total })}
            </p>
            {hasFilters && (
              <div className="flex flex-wrap items-center gap-2">
                {activeChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => updateFilters(chip.remove(filters))}
                    // D7: el nombre accesible dice la ACCIÓN (quitar), no solo el valor.
                    aria-label={t('removeFilter', { label: chip.label })}
                    className="inline-flex items-center gap-1.5 border border-border-strong px-2.5 py-2 font-mono text-xs text-text hover:border-text"
                  >
                    <span lang={chip.lang}>{chip.label}</span>
                    <span aria-hidden>✕</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => updateFilters({})}
                  className="px-1 py-2 font-mono text-xs text-accent hover:text-text"
                >
                  {tc('clearFilters')}
                </button>
              </div>
            )}
            <div className="ml-auto hidden min-w-[210px] lg:block">{sortControl}</div>
          </div>

          <QueryState
            isLoading={catalogQuery.isLoading}
            isError={catalogQuery.isError}
            error={catalogQuery.error}
            onRetry={() => catalogQuery.refetch()}
            loading={
              <div className="gutter grid grid-cols-2 gap-x-4 gap-y-8 py-8 sm:grid-cols-3 lg:gap-x-7 xl:grid-cols-4">
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
                    <Button variant="secondary" onClick={() => updateFilters({})}>
                      {tc('clearFilters')}
                    </Button>
                  )
                }
              />
            ) : (
              <>
                <div className="gutter grid grid-cols-2 gap-x-4 gap-y-8 pb-10 pt-8 sm:grid-cols-3 lg:gap-x-7 xl:grid-cols-4">
                  {catalogQuery.data!.data.map((listing) => (
                    <CatalogTile
                      key={listing.representativeInventoryItemId}
                      listing={listing}
                      onAdd={onAdd}
                      // N-17: estado «en carrito» DERIVADO del store (useCart), sin duplicarlo. El grupo
                      // se refleja «en carrito» cuando su pieza representativa (la más barata) ya está.
                      inCart={cart.ids.includes(listing.representativeInventoryItemId)}
                    />
                  ))}
                </div>
                <div className="pb-14">
                  <Paginator page={page} totalPages={totalPages} onPage={goToPage} />
                </div>
              </>
            )}
          </QueryState>
        </div>
      </div>

      {/* Hoja de filtros (móvil) */}
      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title={tShop('filtersTitle')}>
        <div className="flex flex-col gap-6">
          {searchField}
          <ShopFilters facets={facetsQuery.data} filters={filters} onChange={updateFilters} />
          <Button className="w-full" onClick={() => setSheetOpen(false)}>
            {tShop('applyFilters', { count: total })}
          </Button>
        </div>
      </Modal>

      <CartAddedToast signal={addedSignal} onDismiss={dismissToast} />
    </div>
  );
}

const SEALED_SUBTYPES: SealedSubtype[] = ['box', 'etb', 'bundle', 'tin', 'blister'];

/**
 * Filtros iniciales desde la URL (enlaces del Home: `?setId=<id>`,
 * `?productType=graded`; la pestaña Gradeadas usa `?type=graded`). Solo se
 * mapean los filtros del estado con equivalente trivial en query; los valores
 * de enum se validan contra sus listas — un parámetro inválido se ignora.
 */
function parseUrlFilters(sp: ReadonlyURLSearchParams | null): CatalogFilters {
  if (!sp) return {};
  const f: CatalogFilters = {};
  const setId = sp.get('setId');
  if (setId) f.setId = setId;
  const q = sp.get('q');
  if (q) f.q = q;
  const pt = sp.get('productType') ?? (sp.get('type') === 'graded' ? 'graded' : null);
  if (pt === 'raw' || pt === 'graded' || pt === 'sealed') f.productType = pt;
  const finish = sp.get('finish');
  if (finish && (FINISH_ORDER as string[]).includes(finish)) f.finish = finish as Finish;
  const sub = sp.get('sealedSubtype');
  if (f.productType === 'sealed' && sub && (SEALED_SUBTYPES as string[]).includes(sub))
    f.sealedSubtype = sub as SealedSubtype;
  const rarity = sp.get('rarity');
  if (rarity) {
    const list = rarity.split(',').map((r) => r.trim()).filter(Boolean);
    if (list.length) f.rarity = list;
  }
  const sort = sp.get('sort');
  if (sort === 'newest' || sort === 'price_asc' || sort === 'price_desc') f.sort = sort;
  return f;
}

// Construye los chips removibles del estado de filtros activo.
interface Chip {
  key: string;
  label: string;
  lang?: string;
  remove: (f: CatalogFilters) => CatalogFilters;
}

/**
 * Etiqueta de los chips de precio: pesos enteros sin decimales y, si el límite
 * trae centavos (p. ej. llegó por URL), con los dos decimales — nunca se
 * redondea un límite a otro valor (QA-2).
 */
function pesosLabel(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

function buildChips(filters: CatalogFilters, sets?: { id: string; name: string }[]): Chip[] {
  const chips: Chip[] = [];
  if (filters.q) {
    chips.push({ key: 'q', label: `"${filters.q}"`, remove: (f) => ({ ...f, q: undefined }) });
  }
  if (filters.setId) {
    // Nombre del set desde las facetas ya cargadas; fallback al id si aún no llegan (QA-1).
    const setName = sets?.find((s) => s.id === filters.setId)?.name ?? filters.setId;
    chips.push({ key: 'set', label: setName, lang: 'en', remove: (f) => ({ ...f, setId: undefined }) });
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
    chips.push({ key: 'min', label: `≥ MX$${pesosLabel(filters.minPriceCents)}`, remove: (f) => ({ ...f, minPriceCents: undefined }) });
  }
  if (filters.maxPriceCents != null) {
    chips.push({ key: 'max', label: `≤ MX$${pesosLabel(filters.maxPriceCents)}`, remove: (f) => ({ ...f, maxPriceCents: undefined }) });
  }
  return chips;
}
