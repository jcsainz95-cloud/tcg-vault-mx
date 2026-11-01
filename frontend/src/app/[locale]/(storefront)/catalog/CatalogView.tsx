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
  catalogFiltersKey,
  catalogPageHref,
  parseUrlFilters,
  serializeCatalogFilters,
  sealedHref,
  sealedIntentOf,
} from './catalog-url';
import { useCart } from '@/lib/cart';
import { Link, useRouter } from '@/i18n/navigation';
import { ShopFilters } from '@/components/domain/ShopFilters';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn } from '@/lib/cn';
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
 * La pestaña «Gradeadas» es `?productType=graded`, el mismo parámetro del panel (el alias viejo `type` solo lo lee
 * `parseUrlFilters`).
 */
/**
 * C2 (BRIEF_MKT Ola 2): primera página leída en el SERVIDOR (`page.tsx`) con los MISMOS filtros que esta vista
 * deriva de la URL (`parseUrlFilters`). Si coinciden, es el `initialData` de esa clave: las tejas (con su
 * `<a href>` a la ficha) salen en el HTML crudo y el cliente no repite la lectura al montar.
 */
export interface CatalogInitialPage {
  filters: CatalogFilters;
  data: GroupedListingListResponse;
  /**
   * B-R2 (QA sobre `e066b0b5`): edad del dato al renderizar en el servidor (`CatalogSsrPage.ageMs`, por la cabecera
   * `Date` del backend). La caché de datos de Next es stale-while-revalidate: tras > 30 s sin visitas sirve la copia
   * vieja. Con esta edad react-query sabe si el dato sigue fresco (no relee: la carga fresca hace 0 lecturas) o ya no
   * (relee al montar). Ausente o `null` ⇒ edad desconocida ⇒ vieja.
   */
  ageMs?: number | null;
}

/**
 * B-R2: la hora (reloj del NAVEGADOR) a la que se leyó el dato del servidor = ahora − su edad. Por edad y no por hora
 * absoluta: un reloj del navegador atrasado haría pasar por fresca una copia vieja. ARCHITECTURE §4.DYN (f) 9: edad
 * desconocida, ilegible (no finita) o negativa ⇒ 0 (vieja); una negativa daría `now + |ageMs|`, o sea fresca.
 */
export function initialDataUpdatedAtOf(ageMs: number | null | undefined, now: number): number {
  if (ageMs == null || !Number.isFinite(ageMs) || ageMs < 0) return 0;
  return Math.max(0, now - ageMs);
}

/**
 * MK-D5 / R1 (techlead sobre `561ad425`): la URL es la única fuente de los filtros. Escribe en la barra de direcciones
 * los filtros COMPLETOS (no solo la página) SIN viaje al servidor (`history` nativo, que Next 15 sincroniza con
 * `useSearchParams`); los parámetros ajenos a los filtros se conservan. `push` al paginar (atrás vuelve a la página
 * anterior); `replace` para todo lo demás. No escribe si la URL ya pide lo mismo (`catalogFiltersKey`). Devuelve la
 * query nueva (para que la vista reconozca su propia escritura) o `null` si no cambió nada.
 */
function writeFiltersToUrl(filters: CatalogFilters, mode: 'push' | 'replace'): string | null {
  if (typeof window === 'undefined') return null;
  const current = new URLSearchParams(window.location.search);
  if (catalogFiltersKey(parseUrlFilters(current)) === catalogFiltersKey(filters)) return null;
  const s = serializeCatalogFilters(filters, current).toString();
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
  // Pestaña Gradeadas y enlaces del Home: `productType=graded`; el alias viejo `type` también cuenta.
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
  // C2: la última query que escribió ESTA vista. Su eco en `useSearchParams` no es una navegación del usuario: no se
  // re-aplica sobre el estado (pisaría, p. ej., un término de búsqueda tecleado).
  const ownUrlWrite = useRef<string | null>(null);
  const writeUrl = useCallback((f: CatalogFilters, mode: 'push' | 'replace') => {
    const written = writeFiltersToUrl(f, mode);
    if (written !== null) ownUrlWrite.current = written;
  }, []);
  // MK-D5: clave normalizada de los filtros — la de react-query y la que decide si la URL ya los dice.
  const filtersKey = catalogFiltersKey(filters);
  // MK-D5: estado → URL. Todo cambio de filtro (panel, chips, orden, término debounced, pestaña) queda en la barra de
  // direcciones; paginar ya escribió con `push` en `goToPage`, así que aquí no hay nada que escribir.
  useEffect(() => {
    writeUrl(filters, 'replace');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, writeUrl]);
  useEffect(() => {
    const q = debouncedTerm.trim() ? debouncedTerm : undefined;
    // Cambio real de término ⇒ cambia el universo del resultado: resetea página.
    setFilters((f) => ((f.q ?? '') === (q ?? '') ? f : { ...f, q, page: undefined }));
  }, [debouncedTerm]);
  // MK-D5: atrás/adelante (`popstate`) devuelve una URL que escribió esta vista ⇒ se toma ENTERA (también lo que quita).
  // Cualquier otra navegación con query (pestañas Sueltas/Gradeadas, enlaces internos) se mergea sobre el panel.
  // Guarda la query a la que llevó el `popstate`: un `popstate` que no cambia la query (p. ej. volver del ancla de la
  // nota al pie) no deja la marca puesta para la siguiente navegación.
  const poppedQuery = useRef<string | null>(null);
  useEffect(() => {
    const onPop = () => {
      poppedQuery.current = new URLSearchParams(window.location.search).toString();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Toast de confirmación al agregar (timestamp del último add; 0 = oculto).
  // N-17: además del toast, cada teja refleja «En el carrito» derivado del store.
  const [addedSignal, setAddedSignal] = useState(0);
  const dismissToast = useCallback(() => setAddedSignal(0), []);
  // Ancla del scroll al paginar: la barra de resultados, no el tope de la página.
  const resultsRef = useRef<HTMLDivElement>(null);

  // URL → filtros. Atrás/adelante toma la URL entera (MK-D5). Navegar entre pestañas (Sueltas ↔ Gradeadas) o un
  // enlace interno con query MERGEA los filtros presentes en la URL sobre el estado (sin borrar lo elegido en el
  // panel) y retira `graded` al salir de la pestaña; el efecto estado → URL vuelve a escribir el resultado. El ref
  // evita re-aplicar en renders sin cambio real de URL (y el eco de la propia escritura, `ownUrlWrite`).
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
    const popped = poppedQuery.current === urlKey;
    poppedQuery.current = null;
    if (popped) {
      setSearchTerm(fromUrl.q ?? '');
      setFilters(fromUrl);
      return;
    }
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
   * Todo cambio de filtro u orden pasa por aquí: resetea la página (el resultado cambia de universo). La URL (también
   * la de la pestaña Gradeadas, `productType=graded`) la escribe el efecto estado → URL.
   */
  const updateFilters = useCallback(
    (next: CatalogFilters) => {
      // Si el caller cambió `q` explícitamente (chip «✕»), el input se sincroniza; si `q` viene igual (cambio de
      // orden/facetas), el input no se toca para no pisar un término aún sin debouncear.
      if ((next.q ?? '') !== (filters.q ?? '')) setSearchTerm(next.q ?? '');
      setFilters({ ...next, page: undefined });
    },
    [filters.q],
  );
  /**
   * MK-D8: «Limpiar filtros» limpia TODO, también el término tecleado que aún no pasó el debounce de 300 ms (antes
   * `updateFilters({})` comparaba con `filters.q`, vacío en esa ventana, y el término pendiente entraba después).
   */
  const clearFilters = useCallback(() => {
    setSearchTerm('');
    updateFilters({});
  }, [updateFilters]);

  const facetsQuery = useQuery({ queryKey: ['facets'], queryFn: getCatalogFacets });
  // B-R2: el instante del montaje, fijo (react-query solo lee `initialDataUpdatedAt` al crear la entrada de la clave).
  const [mountedAt] = useState(() => Date.now());
  // C2: la lectura del servidor solo vale para SU clave (los filtros con que se pidió).
  const initialMatches = !!initialPage && catalogFiltersKey(initialPage.filters) === filtersKey;
  const catalogQuery = useQuery({
    queryKey: ['catalog', filtersKey],
    queryFn: () => getCatalog({ ...filters, sort: filters.sort ?? DEFAULT_CATALOG_SORT }),
    initialData: initialMatches ? initialPage.data : undefined,
    // B-R2: con la edad real, una copia vieja de la caché de datos se revalida al hidratar; una fresca, no.
    initialDataUpdatedAt: initialMatches ? initialDataUpdatedAtOf(initialPage.ageMs, mountedAt) : undefined,
    // R5: paginar/filtrar no desmonta la grilla — se sigue mostrando la página
    // anterior mientras llega la nueva (isLoading solo en el primer fetch).
    placeholderData: keepPreviousData,
    // D-EQ-3: con intención de sellado esta rejilla no se consulta. No es una optimización —
    // es lo que impide gastar una petición cuya respuesta ya sabemos que no sirve (y, cuando
    // backend cierre el dominio, un `400` de camino a una pantalla que ya nos vamos a ir).
    enabled: !sealedIntent,
  });

  const tType = useTranslations('shop.type');
  const tFinish = useTranslations('finish');
  const activeChips = useMemo(
    // Las facetas dan el nombre legible del set para el chip (QA-1); tipo y acabado, su etiqueta del panel (MK-D4).
    () => buildChips(filters, facetsQuery.data?.sets, { type: (pt) => tType(pt), finish: (f) => tFinish(f) }),
    [filters, facetsQuery.data?.sets, tType, tFinish],
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
    const next = { ...filters, page: p <= 1 ? undefined : p };
    setFilters(next);
    writeUrl(next, 'push');
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

  // MKT-CONV.8: el mismo control en la fila móvil, sin etiqueta visible y con el campo a 44 px de alto.
  const mobileSortControl = (
    <Select
      label={tShop('sortLabel')}
      labelClassName="sr-only"
      fieldClassName="mt-0 flex h-11 items-center pb-0"
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
      // §22.5 «Excepción vigente (2026-11-01)»: en < sm ni la cifra de las tejas ni su nota. ÚNICO sitio del corte
      // (TL-MKT6-1): la boundary lo aplica a la nota y lo publica a los badges.
      figureClassName="hidden sm:block"
    >
      <div>
      {/* Encabezado (artboard 2a): eyebrow · título mincho · conteo mono a la línea base.
          MKT-CONV.8 (PROJECT 943): en < lg se pliega — eyebrow oculto (decorativo), `h1` 24/28 px con el conteo en
          la misma línea, `pt-4 pb-2` (52 px). En lg, igual que antes. */}
      <div className="gutter flex flex-row items-baseline justify-between gap-4 pb-2 pt-4 lg:items-end lg:pb-6 lg:pt-10">
        <div className="min-w-0">
          <p className="eyebrow hidden lg:block" data-testid="catalog-eyebrow">
            {t('eyebrow')}
          </p>
          <h1 className="font-serif text-[24px] leading-[28px] text-text lg:mt-3 lg:text-[40px] lg:leading-[1.1]">
            {t('title')}
          </h1>
        </div>
        <p className="tabular shrink-0 font-mono text-[11px] leading-none text-muted">
          {t('piecesAvailable', { count: total })}
        </p>
      </div>

      <StoreTabs />

      {/* Acciones móviles: filtros (con conteo activo en rojo) y orden. MKT-CONV.8: UNA fila de 56 px (`py-1.5` +
          controles de 44 px); la etiqueta del orden queda `sr-only` (el `<select>` conserva su nombre accesible). */}
      <div className="gutter flex items-center gap-2.5 py-1.5 lg:hidden" data-testid="catalog-mobile-actions">
        <Button variant="secondary" size="sm" className="h-11 flex-1 sm:min-h-[44px]" onClick={() => setSheetOpen(true)}>
          {tShop('filtersTitle')}
          {hasFilters && (
            <span className="tabular font-mono text-accent" aria-hidden>
              {activeChips.length}
            </span>
          )}
        </Button>
        <div className="flex-1">{mobileSortControl}</div>
      </div>

      <div className="grid border-t border-border lg:grid-cols-[252px_1fr] lg:border-t-0">
        {/* Índice de filtros (lg+): 252px, regla de columna completa. */}
        <aside className="hidden border-r border-border px-6 pb-16 pt-7 lg:block">
          <div className="flex items-baseline justify-between">
            <p className="eyebrow">{tShop('filtersTitle')}</p>
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
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
            // MKT-CONV.8: en < lg la barra solo ocupa alto si hay chips (una fila de 48 px con scroll horizontal, sin
            // wrap); sin chips mide 0 y el conteo, `sr-only`, sigue siendo la región viva. En lg, igual que antes.
            className={cn(
              'gutter flex items-center gap-x-4 scroll-mt-[calc(var(--app-header-h,0px)+16px)] lg:flex-wrap lg:gap-y-3 lg:border-b lg:border-border lg:py-4',
              hasFilters ? 'h-12 flex-nowrap overflow-x-auto border-b border-border lg:h-auto lg:overflow-visible' : 'h-0 lg:h-auto',
            )}
          >
            <p
              role="status"
              aria-live="polite"
              data-testid="catalog-results-count"
              className="tabular sr-only font-mono text-[11px] text-muted lg:not-sr-only"
            >
              {t('resultsCount', { count: total })}
            </p>
            {hasFilters && (
              <div className="flex shrink-0 flex-nowrap items-center gap-2 lg:shrink lg:flex-wrap">
                {activeChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => updateFilters(chip.remove(filters))}
                    // D7: el nombre accesible dice la ACCIÓN (quitar), no solo el valor.
                    aria-label={t('removeFilter', { label: chip.label })}
                    className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border border-border-strong px-2.5 py-2 font-mono text-xs text-text hover:border-text"
                  >
                    <span lang={chip.lang}>{chip.label}</span>
                    <span aria-hidden>✕</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={clearFilters}
                  className="shrink-0 whitespace-nowrap px-1 py-2 font-mono text-xs text-accent hover:text-text"
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
              <div className="gutter grid grid-cols-2 gap-x-4 gap-y-8 pb-8 pt-3 sm:grid-cols-3 lg:gap-x-7 lg:pt-8 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            }
          >
            {(catalogQuery.data?.data.length ?? 0) === 0 && total > 0 && page > totalPages ? (
              // M-2 (QA sobre 561ad425): `?page=99` con resultados no es «Ninguna carta coincide»; la página no existe
              // y se ofrece volver a la 1 con los mismos filtros (enlace rastreable; el clic pagina en el cliente).
              <EmptyState
                title={t('pageOutOfRange.title')}
                body={t('pageOutOfRange.body')}
                action={
                  <Link
                    href={catalogPageHref(filters, 1, searchParams)}
                    onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                      e.preventDefault();
                      goToPage(1);
                    }}
                    className="inline-flex min-h-[44px] items-center text-sm text-text underline underline-offset-4 hover:text-accent"
                  >
                    {t('pageOutOfRange.action')}
                  </Link>
                }
              />
            ) : (catalogQuery.data?.data.length ?? 0) === 0 ? (
              <EmptyState
                title={t('emptyTitle')}
                body={t('emptyBody')}
                action={
                  hasFilters && (
                    <Button variant="secondary" onClick={clearFilters}>
                      {tc('clearFilters')}
                    </Button>
                  )
                }
              />
            ) : (
              <>
                {/* MKT-CONV.8: `pt-3` en < lg (antes `pt-8`): con la regla de arriba, 13 px. */}
                <div className="gutter grid grid-cols-2 gap-x-4 gap-y-8 pb-10 pt-3 sm:grid-cols-3 lg:gap-x-7 lg:pt-8 xl:grid-cols-4">
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
                    hrefFor={(p) => catalogPageHref(filters, p, searchParams)}
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

/** MK-D4: etiquetas localizadas (las mismas del panel de filtros) para los chips de enum. */
interface ChipLabels {
  type: (pt: NonNullable<CatalogFilters['productType']>) => string;
  finish: (f: NonNullable<CatalogFilters['finish']>) => string;
}

function buildChips(
  filters: CatalogFilters,
  sets: { id: string; name: string }[] | undefined,
  labels: ChipLabels,
): Chip[] {
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
      label: labels.type(filters.productType),
      remove: (f) => ({ ...f, productType: undefined }),
    });
  }
  // (D-EQ-3: el chip de `sealedSubtype` se va con el filtro. Era, además, el que pintaba el token
  // crudo «box» junto a un «sealed» igual de crudo sobre una rejilla vacía.)
  if (filters.finish) {
    // v1.6-finish: chip del acabado activo, con la etiqueta localizada del panel (`finish.*`, MK-D4).
    chips.push({ key: 'finish', label: labels.finish(filters.finish), remove: (f) => ({ ...f, finish: undefined }) });
  }
  if (filters.minPriceCents != null) {
    chips.push({ key: 'min', label: `≥ MX$${pesosLabel(filters.minPriceCents)}`, remove: (f) => ({ ...f, minPriceCents: undefined }) });
  }
  if (filters.maxPriceCents != null) {
    chips.push({ key: 'max', label: `≤ MX$${pesosLabel(filters.maxPriceCents)}`, remove: (f) => ({ ...f, maxPriceCents: undefined }) });
  }
  return chips;
}
