'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { StoreTabs } from '@/components/domain/StoreTabs';
import { getCatalog, getCatalogFacets, type CatalogFilters, type CatalogSort } from '@/lib/api';
import type { GroupedListingListResponse, GroupedListingSummaryDTO } from '@/types/contract';
import {
  DEFAULT_CATALOG_SORT,
  catalogPageHref,
  parseUrlFilters,
  sealedHref,
  sealedIntentOf,
} from './catalog-url';
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
import { GradingFootnoteBoundary } from '../_shared/grading/GradingFootnote';
import { pageHasGradingFigures } from '../_shared/grading/estimates';

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
/**
 * C2 (BRIEF_MKT Ola 2): primera página leída en el SERVIDOR (`page.tsx`) con los MISMOS filtros que esta vista
 * deriva de la URL (`parseUrlFilters`). Si coinciden, es el `initialData` de esa clave: las tejas (con su
 * `<a href>` a la ficha) salen en el HTML crudo y el cliente no repite la lectura al montar.
 */
export interface CatalogInitialPage {
  filters: CatalogFilters;
  data: GroupedListingListResponse;
}

/** Misma clave de consulta ⇔ mismos filtros (los dos salen de `parseUrlFilters`, mismo orden de campos). */
function sameFilters(a: CatalogFilters, b: CatalogFilters): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * C2: refleja la página en la barra de direcciones SIN viaje al servidor (`history` nativo, que Next 15 sincroniza
 * con `useSearchParams`). `push` al paginar (atrás vuelve a la página anterior); `replace` al resetear por filtro.
 * Devuelve la query nueva (para que la vista reconozca su propia escritura) o `null` si no cambió nada.
 */
function writePageToUrl(page: number | undefined, mode: 'push' | 'replace'): string | null {
  if (typeof window === 'undefined') return null;
  const qs = new URLSearchParams(window.location.search);
  const had = qs.get('page');
  if (page && page > 1) qs.set('page', String(page));
  else qs.delete('page');
  if ((had ?? '') === (page && page > 1 ? String(page) : '')) return null;
  const s = qs.toString();
  const url = `${window.location.pathname}${s ? `?${s}` : ''}`;
  if (mode === 'push') window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
  return s;
}

export function CatalogView({ initialPage }: { initialPage?: CatalogInitialPage } = {}) {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const tShop = useTranslations('shop');
  const cart = useCart();
  const router = useRouter();
  const searchParams = useSearchParams();
  // La pestaña Gradeadas usa ?type=graded; los enlaces del Home usan ?productType=graded.
  const gradedTab =
    searchParams?.get('type') === 'graded' || searchParams?.get('productType') === 'graded';

  // D-EQ-3: esta URL pide sellado ⇒ no es de esta vista. Se resuelve ANTES que nada (ver el
  // bloque de `sealedIntentOf`): sin consultar la rejilla de singles y sin pintarla.
  const sealedIntent = useMemo(() => sealedIntentOf(searchParams), [searchParams]);

  // Los filtros se inicializan desde la URL (enlaces del Home: ?setId=, ?productType=…).
  const [filters, setFilters] = useState<CatalogFilters>(() => parseUrlFilters(searchParams));
  // R5: el input de búsqueda es estado propio INMEDIATO (UX responsiva) y solo su
  // valor DEBOUNCED entra a los filtros/queryKey — sin un fetch por pulsación
  // (mismo patrón P-5 de useDebouncedValue que HomeQuoter/M3).
  const [searchTerm, setSearchTerm] = useState<string>(() => parseUrlFilters(searchParams).q ?? '');
  const debouncedTerm = useDebouncedValue(searchTerm, 300);
  // C2: la última query que escribió ESTA vista (paginar / resetear la página). Su eco en `useSearchParams` no es una
  // navegación del usuario: no se re-aplica sobre el estado (pisaría, p. ej., un término de búsqueda tecleado).
  const ownUrlWrite = useRef<string | null>(null);
  const writePage = useCallback((page: number | undefined, mode: 'push' | 'replace') => {
    const written = writePageToUrl(page, mode);
    if (written !== null) ownUrlWrite.current = written;
  }, []);
  useEffect(() => {
    const q = debouncedTerm.trim() ? debouncedTerm : undefined;
    // Cambio real de término ⇒ cambia el universo del resultado: resetea página.
    setFilters((f) => {
      if ((f.q ?? '') === (q ?? '')) return f;
      writePage(undefined, 'replace');
      return { ...f, q, page: undefined };
    });
  }, [debouncedTerm, writePage]);
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
    if (ownUrlWrite.current === urlKey) {
      ownUrlWrite.current = null;
      return;
    }
    const fromUrl = parseUrlFilters(searchParams);
    // Un q que llega por URL también debe reflejarse en el input (fuente inmediata).
    if (fromUrl.q != null) setSearchTerm(fromUrl.q);
    setFilters((f) => {
      // C2: la página la dice la URL (`?page=`, también al volver atrás); sin ella, la 1.
      const next: CatalogFilters = { ...f, ...fromUrl, page: fromUrl.page };
      if (!gradedTab && f.productType === 'graded' && fromUrl.productType == null)
        next.productType = undefined;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);

  /**
   * D-EQ-3 · la única salida honesta para un enlace de sellado: llevarlo a §2-S.
   * `replace` (no `push`) porque esto no es un paso de navegación del usuario: es la corrección
   * de una URL que ya no existe en el contrato — dejarla en el historial haría que «atrás»
   * devolviera al callejón sin salida.
   */
  useEffect(() => {
    if (sealedIntent) router.replace(sealedHref(sealedIntent));
  }, [sealedIntent, router]);

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
      writePage(undefined, 'replace');
      if (gradedTab && next.productType !== 'graded') router.replace('/catalog');
      else if (!gradedTab && next.productType === 'graded') router.replace('/catalog?type=graded');
    },
    [filters.q, gradedTab, router, writePage],
  );

  const facetsQuery = useQuery({ queryKey: ['facets'], queryFn: getCatalogFacets });
  const catalogQuery = useQuery({
    queryKey: ['catalog', filters],
    queryFn: () => getCatalog({ ...filters, sort: filters.sort ?? DEFAULT_CATALOG_SORT }),
    // C2: la lectura del servidor solo vale para SU clave (los filtros con que se pidió).
    initialData: initialPage && sameFilters(initialPage.filters, filters) ? initialPage.data : undefined,
    // R5: paginar/filtrar no desmonta la grilla — se sigue mostrando la página
    // anterior mientras llega la nueva (isLoading solo en el primer fetch).
    placeholderData: keepPreviousData,
    // D-EQ-3: con intención de sellado esta rejilla no se consulta. No es una optimización —
    // es lo que impide gastar una petición cuya respuesta ya sabemos que no sirve (y, cuando
    // backend cierre el dominio, un `400` de camino a una pantalla que ya nos vamos a ir).
    enabled: !sealedIntent,
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
  function onAdd(group: GroupedListingSummaryDTO) {
    cart.add(group.representativeInventoryItemId);
    setAddedSignal(Date.now());
  }

  function goToPage(p: number) {
    setFilters((f) => ({ ...f, page: p <= 1 ? undefined : p }));
    writePage(p, 'push');
    // jsdom no implementa scrollIntoView; el guard evita romper los tests.
    resultsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  const sortControl = (
    <Select
      label={tShop('sortLabel')}
      options={SORTS.map((s) => ({ value: s, label: tShop(`sort.${s}`) }))}
      value={filters.sort ?? DEFAULT_CATALOG_SORT}
      onChange={(e) => updateFilters({ ...filters, sort: (e.target.value || DEFAULT_CATALOG_SORT) as CatalogSort })}
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

  /**
   * D-EQ-3 · mientras la redirección se resuelve NO se pinta la rejilla de singles. Ni con tejas ni
   * —sobre todo— con «Ninguna carta coincide»: ese vacío es literalmente el defecto que este
   * cambio corrige, y verlo parpadear medio segundo camino a `/sellado` lo dejaría intacto para el
   * ojo del usuario. Se anuncia el traslado en una región viva, que es lo que un lector de pantalla
   * necesita cuando la página cambia sola bajo sus pies (§8.2).
   */
  if (sealedIntent) {
    return (
      <div className="gutter py-16">
        <p role="status" aria-live="polite" className="text-[15px] leading-relaxed text-muted">
          {t('sealedRedirect')}
        </p>
      </div>
    );
  }

  return (
    // §22.4b: la nota al pie de Compra se renderiza si LA PÁGINA ACTUAL muestra ≥ 1 badge, y se
    // reevalúa al paginar/filtrar. §22 R3.(3): el MISMO booleano habilita las cifras (vía contexto)
    // y la nota — no hay dos condiciones que puedan divergir en un refactor.
    <GradingFootnoteBoundary
      active={pageHasGradingFigures(catalogQuery.data?.data)}
      returnToId="catalogo-resultados"
    >
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
            // Destino del enlace de regreso de la nota al pie (§22.4a): el viaje es de ida Y vuelta.
            id="catalogo-resultados"
            className="gutter flex flex-wrap items-center gap-x-4 gap-y-3 scroll-mt-[calc(var(--app-header-h,0px)+16px)] border-b border-border py-4"
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
                  <Paginator
                    page={page}
                    totalPages={totalPages}
                    onPage={goToPage}
                    hrefFor={(p) => catalogPageHref(searchParams, p)}
                  />
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
    </GradingFootnoteBoundary>
  );
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
      remove: (f) => ({ ...f, productType: undefined }),
    });
  }
  // (D-EQ-3: el chip de `sealedSubtype` se va con el filtro. Era, además, el que pintaba el token
  // crudo «box» junto a un «sealed» igual de crudo sobre una rejilla vacía.)
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
