'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getCatalog } from '@/lib/api';
import type { GroupedListingSummaryDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { CardImage } from '@/components/ui/CardImage';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryState } from '@/components/ui/QueryState';
import { Shelf } from '../_shared/Shelf';
import { StockBadge, stockVariantForSingle } from '../_shared/StockBadge';
import { PendingPriceLabel } from '../_shared/PendingPriceLabel';
import { FinishLabel } from '../_shared/FinishLabel';
import { GradingEstimateBadge } from '../_shared/grading/GradingEstimateBadge';
import { useGradingFootnote } from '../_shared/grading/GradingFootnote';
import { pageHasGradingFigures } from '../_shared/grading/estimates';
import { cn } from '@/lib/cn';

const FEATURED = 8;

/** `id` de la sección: destino del regreso de la nota al pie cuando la vitrina no pintó (§22.4a). */
export const FEATURED_CAROUSEL_ID = 'piezas-destacadas';

/**
 * Fuente del carrusel, COMPARTIDA con la página del home (§22.6b-g). El home decide si hospeda la
 * nota al pie con la **unión** vitrina ∪ carrusel, y tiene que hacerlo sobre **esta misma lista**:
 * dos consultas distintas podrían divergir y reabrir el fallo silencioso (sin nota, `fail-closed`
 * apaga toda cifra y **nadie ve un error**). TanStack dedupe por `queryKey`, así que sigue siendo
 * una sola petición. Es el mismo patrón que ya usa `useGradingGems`.
 *
 * No hay filtro `?gradingHighlight=true` aquí y no hace falta: `GET /catalog/cards` emite
 * `gradingHighlight` en el summary de todo grupo raw elegible, con o sin ese filtro (el filtro solo
 * FILTRA). El carrusel recibe las 8 más caras y algunas resultan traer el marcador.
 */
export function useFeaturedCatalog() {
  return useQuery({
    queryKey: ['catalog', { home: true, sort: 'price_desc' }],
    queryFn: () => getCatalog({ sort: 'price_desc', pageSize: FEATURED }),
  });
}

/** Los grupos que el carrusel pinta. `[]` ⇒ la pista no existe (mensaje de vacío). */
export function featuredOf(
  data: { data: GroupedListingSummaryDTO[] } | undefined,
): GroupedListingSummaryDTO[] {
  return data?.data ?? [];
}

/** Renglón mono de la teja: set · #num (+ empresa/grado si es gradeada). */
function tileMeta(l: GroupedListingSummaryDTO): string {
  const base = `${l.card.setName} · #${l.card.number}`;
  return l.gradingCompany ? `${base} · ${l.gradingCompany} ${l.gradeValue ?? ''}`.trim() : base;
}

/** Precio de la teja: SIEMPRE formateado del server; sin precio ⇒ "pendiente", nunca $0. */
function TilePrice({ l, locale, big = false }: { l: GroupedListingSummaryDTO; locale: AppLocale; big?: boolean }) {
  if (l.salePriceCents == null) {
    return <PendingPriceLabel className="mt-3 block" />;
  }
  return (
    <p
      className={cn(
        'tabular font-medium leading-none text-text',
        big ? 'text-[17px] lg:text-[25px]' : 'mt-3 text-[15px] lg:text-[17px]',
      )}
    >
      {formatMoneyCents(l.salePriceCents, locale)}
    </p>
  );
}

/**
 * «Piezas destacadas del catálogo» (makeover 1a §4): carrusel horizontal con las piezas
 * más caras del inventario publicado (el backend ordena por salePriceCents server-side).
 * Primera teja grande, resto numeradas en mono rojo (numeración decorativa, aria-hidden
 * §20.3). v1.38-grouped-listings (P-30): la fuente (GET /catalog/cards) es AGRUPADA, así que
 * cada teja es un `GroupedListingSummaryDTO` (v2.1.9/D2: la rejilla ya no recibe `priceBasis`
 * ni `referenceValue`) con `stockCount` real (badge Queda 1 / N en stock).
 *
 * **CUARTA superficie del gancho de grading (§22.6b).** Las dos tejas de esta pista pueden llevar la
 * burbuja del estimado. Tres cosas que NO son negociables aquí:
 *
 *  - **El caso disparejo es el NORMAL.** La pista ordena por precio descendente y el gate de ROI
 *    castiga justo a las caras: lo esperable es **cero burbujas**, y cuando las haya, una o dos entre
 *    ocho. Por eso el badge es el ÚLTIMO elemento de las dos tejas y **no se compensa nada**: sin
 *    `min-height`, sin espacio reservado, sin regla ni guion de relleno, sin skeleton del badge y sin
 *    reordenar por elegibilidad (§22.6b-d/i). La ausencia no es un estado degradado.
 *  - **La teja es un `<a>` que envuelve todo**, así que el badge queda DENTRO del enlace y su texto
 *    forma parte del **nombre accesible**: el lector anuncia nombre, set, precio, stock, la cifra y
 *    el micro-aviso completo. Eso es deseable ⇒ **prohibido ponerle `aria-label` al enlace** de la
 *    teja: sustituiría el contenido y borraría el aviso del árbol de accesibilidad, que es el
 *    defecto bloqueante que §22.4c corrigió (§22.6b-h).
 *  - **El encabezado NO cambia** (§22.6b-e): sin kicker, sin subtítulo, sin mención al gradeo. El
 *    carrusel no es una vitrina de gancho; es la pista de las piezas más caras, y algunas resultan
 *    llevar además una cifra estimada.
 */
export function FeaturedCarousel() {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const anchors = useGradingFootnote();

  const catalog = useFeaturedCatalog();
  const featured = featuredOf(catalog.data);

  /**
   * §22.6b-c — **numeración condicional POR PISTA, todo o nada.** Si el carrusel pinta al menos una
   * cifra, la numeración `01·02·03` desaparece de las OCHO tejas: un ordinal rojo encima de un «vale
   * ≈ MX$29,000» se lee como *ranking de oportunidad* (la afirmación que §O prohíbe), sería el
   * tercer rojo de una teja de 160px (§22.10 nº3) y quitarlo solo en las tejas con burbuja
   * desalinearía los nombres de la fila.
   *
   * El predicado es el MISMO que gobierna las cifras — incluido el `fail-closed` de la nota al pie:
   * sin boundary activa el badge devuelve `null`, así que sin `anchors` NO se pinta ninguna cifra y
   * la numeración se queda. Así es imposible que la pista pierda los números sin ganar la burbuja.
   */
  const trackShowsFigures = anchors !== null && pageHasGradingFigures(featured);
  const showNumbering = !trackShowsFigures;

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateArrows();
    window.addEventListener('resize', updateArrows);
    return () => window.removeEventListener('resize', updateArrows);
  }, [updateArrows, featured.length]);

  function scrollByDir(dir: 1 | -1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: 'smooth' });
  }

  const arrowBase = 'inline-flex h-8 w-8 items-center justify-center border lg:h-[38px] lg:w-[38px]';

  return (
    <Shelf
      id={FEATURED_CAROUSEL_ID}
      // §22.6b-g: el regreso de la nota al pie puede aterrizar aquí, así que la sección necesita su
      // propio `scroll-mt` derivado de `--app-header-h` (§4.5) para no quedar tapada por el header.
      className="scroll-mt-[calc(var(--app-header-h,0px)+16px)]"
      ariaLabel={t('featuredTitle')}
      title={
        <>
          <span className="lg:hidden">{t('featuredTitleShort')}</span>
          <span className="hidden lg:inline">{t('featuredTitle')}</span>
        </>
      }
      headerClassName="items-end pb-5 pt-10 lg:pt-12"
      viewAllHref="/catalog"
      viewAllLabel={t('viewAllCatalog')}
      viewAllClassName="hidden sm:inline"
      actions={
        <div className="flex gap-2">
          <button
            type="button"
            aria-label={t('carouselPrev')}
            onClick={() => scrollByDir(-1)}
            disabled={!canPrev}
            className={cn(arrowBase, canPrev ? 'border-text text-text' : 'border-border-strong text-muted')}
          >
            ←
          </button>
          <button
            type="button"
            aria-label={t('carouselNext')}
            onClick={() => scrollByDir(1)}
            disabled={!canNext}
            className={cn(arrowBase, canNext ? 'border-text text-text' : 'border-border-strong text-muted')}
          >
            →
          </button>
        </div>
      }
    >
      {/* R3: el error usa el QueryState compartido (Banner + Reintentar); el wrapper
          solo aporta el gutter en esa rama para no alterar la pista de scroll. */}
      <div className={catalog.isError ? 'gutter pb-12' : undefined}>
        <QueryState
          isLoading={catalog.isLoading}
          isError={catalog.isError}
          error={catalog.error}
          onRetry={() => catalog.refetch()}
          loading={
            <div className="gutter flex gap-4 overflow-hidden pb-10 lg:gap-7 lg:pb-14">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className={cn('shrink-0', i === 0 ? 'aspect-[5/7] w-[236px] lg:w-[400px]' : 'aspect-[5/7] w-[160px] lg:w-[268px]')} />
              ))}
            </div>
          }
        >
          {featured.length === 0 ? (
            <p className="gutter pb-12 text-sm text-muted">{tc('noResults')}</p>
          ) : (
            <div
              ref={scrollerRef}
              onScroll={updateArrows}
              className="gutter flex snap-x gap-4 overflow-x-auto pb-10 [scrollbar-width:none] lg:gap-7 lg:pb-14 [&::-webkit-scrollbar]:hidden"
            >
              {featured.map((l, i) =>
                i === 0 ? (
                  <Link
                    key={l.representativeInventoryItemId}
                    href={`/catalog/${l.card.id}`}
                    className="w-[236px] shrink-0 snap-start lg:w-[400px]"
                  >
                    {/* P-39: teja destacada grande ⇒ imagen de alta resolución (fallback a la chica si null). */}
                    <CardImage src={l.card.imageLargeUrl ?? l.card.imageSmallUrl} alt={l.card.name} />
                    <div className="mt-3 flex flex-col gap-2 lg:mt-[18px] lg:flex-row lg:items-end lg:justify-between lg:gap-5">
                      <div className="min-w-0">
                        <p lang="en" className="font-serif text-[17px] leading-[1.25] text-text lg:text-[26px] lg:leading-[1.2]">
                          {l.card.name}
                        </p>
                        <p lang="en" className="mt-2 font-mono text-[11px] leading-snug text-muted">
                          {tileMeta(l)}
                        </p>
                        {/* P-40: acabado legible (Normal / Reverse Holo / Holofoil); sellado no aplica (grupos = raw|graded). */}
                        <FinishLabel finish={l.finish} productType={l.productType} className="mt-2" />
                      </div>
                      <div className="shrink-0 lg:text-right">
                        <TilePrice l={l} locale={locale} big />
                        <StockBadge variant={stockVariantForSingle(l.stockCount)} count={l.stockCount} className="mt-1.5" />
                      </div>
                    </div>
                    {/* §22.6b-a: ÚLTIMO elemento de la teja, DEBAJO de toda la fila de datos y a
                        TODO EL ANCHO (no dentro de la columna derecha del precio, que es estrecha y
                        va `text-right`: ahí la prosa del aviso quedaría en bandera derecha). El
                        orden de lectura es nombre → set/# → acabado → precio real → stock →
                        estimado → micro-aviso. Nada de lo que está encima se mueve un píxel. */}
                    <GradingEstimateBadge listing={l} surface="featuredLead" />
                  </Link>
                ) : (
                  <Link
                    key={l.representativeInventoryItemId}
                    href={`/catalog/${l.card.id}`}
                    className="w-[160px] shrink-0 snap-start lg:w-[268px]"
                  >
                    {/* P-39: teja destacada (showcase prominente, no grid denso) ⇒ alta resolución con fallback. */}
                    <CardImage src={l.card.imageLargeUrl ?? l.card.imageSmallUrl} alt={l.card.name} />
                    <div className="mt-3 flex items-baseline gap-2 lg:mt-[15px]">
                      {/* Numeración decorativa/orientadora (§20.3): el orden real lo da el DOM.
                          §22.6b-c: se apaga en TODA la pista si la pista pinta alguna cifra. Nunca
                          se renumera para tapar el hueco, ni se sustituye por otro glifo, ni queda
                          espacio reservado donde estaba. */}
                      {showNumbering && (
                        <span aria-hidden className="font-mono text-[10px] leading-none text-accent">
                          {String(i).padStart(2, '0')}
                        </span>
                      )}
                      <p lang="en" className="font-serif text-sm leading-[1.3] text-text lg:text-base">
                        {l.card.name}
                      </p>
                    </div>
                    <p lang="en" className="mt-1.5 font-mono text-[11px] leading-snug text-muted">
                      {tileMeta(l)}
                    </p>
                    {/* P-40: acabado legible bajo el renglón mono de set · número. */}
                    <FinishLabel finish={l.finish} productType={l.productType} className="mt-1.5" />
                    <TilePrice l={l} locale={locale} />
                    <StockBadge variant={stockVariantForSingle(l.stockCount)} count={l.stockCount} className="mt-1.5" />
                    {/* §22.6b-b: DESPUÉS del StockBadge, último elemento de la teja. `figureShort`
                        siempre (`surface="featuredRest"`): la forma larga en EN pide ~274px y la
                        teja mide 268px en su mejor momento. Sin `min-height` ni espacio reservado en
                        las tejas sin cifra: la ausencia es el estado NORMAL de esta pista (§22.6b-d). */}
                    <GradingEstimateBadge listing={l} surface="featuredRest" />
                  </Link>
                ),
              )}
            </div>
          )}
        </QueryState>
      </div>
    </Shelf>
  );
}
