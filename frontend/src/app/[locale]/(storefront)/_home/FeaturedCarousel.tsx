'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getCatalog } from '@/lib/api';
import type { ListingDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { CardImage } from '@/components/ui/CardImage';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

const FEATURED = 8;

/** Renglón mono de la teja: set · #num (+ empresa/grado si es gradeada). */
function tileMeta(l: ListingDTO): string {
  const base = `${l.card.setName} · #${l.card.number}`;
  return l.gradingCompany ? `${base} · ${l.gradingCompany} ${l.gradeValue ?? ''}`.trim() : base;
}

/** Precio de la teja: SIEMPRE formateado del server; sin precio ⇒ "pendiente", nunca $0. */
function TilePrice({ l, locale, big = false }: { l: ListingDTO; locale: AppLocale; big?: boolean }) {
  const t = useTranslations('home');
  if (l.salePriceCents == null) {
    return (
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
        {t('pricePending')}
      </p>
    );
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
 * Primera teja grande, resto numeradas en mono rojo. Modelo actual: 1 publicación = 1
 * copia física ⇒ el badge honesto de cada teja es «Queda 1» (no existe stock agregado
 * por carta en /catalog/cards — no se inventa un "N en stock").
 */
export function FeaturedCarousel() {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;

  const catalog = useQuery({
    queryKey: ['catalog', { home: true, sort: 'price_desc' }],
    queryFn: () => getCatalog({ sort: 'price_desc', pageSize: FEATURED }),
  });
  const featured = (catalog.data?.data ?? []).filter((l) => l.sellable);

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
    <section aria-label={t('featuredTitle')}>
      <div className="gutter flex items-end justify-between gap-4 pb-5 pt-10 lg:pt-12">
        <h2 className="font-serif text-[22px] leading-tight text-text lg:text-[29px]">
          <span className="lg:hidden">{t('featuredTitleShort')}</span>
          <span className="hidden lg:inline">{t('featuredTitle')}</span>
        </h2>
        <div className="flex items-center gap-4 lg:gap-[22px]">
          <Link
            href="/catalog"
            className="hidden text-[11px] font-medium uppercase tracking-label text-muted hover:text-text sm:inline"
          >
            {t('viewAllCatalog')}
          </Link>
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
        </div>
      </div>

      {catalog.isError ? (
        <div className="gutter pb-12">
          <div className="rule-note py-1">
            <p className="text-sm font-medium text-accent">{tc('errorTitle')}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => catalog.refetch()}>
              {tc('retry')}
            </Button>
          </div>
        </div>
      ) : catalog.isLoading ? (
        <div className="gutter flex gap-4 overflow-hidden pb-10 lg:gap-7 lg:pb-14">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className={cn('shrink-0', i === 0 ? 'aspect-[5/7] w-[236px] lg:w-[400px]' : 'aspect-[5/7] w-[160px] lg:w-[268px]')} />
          ))}
        </div>
      ) : featured.length === 0 ? (
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
                key={l.inventoryItemId}
                href={`/catalog/${l.card.id}`}
                className="w-[236px] shrink-0 snap-start lg:w-[400px]"
              >
                <CardImage src={l.card.imageSmallUrl} alt={l.card.name} />
                <div className="mt-3 flex flex-col gap-2 lg:mt-[18px] lg:flex-row lg:items-end lg:justify-between lg:gap-5">
                  <div className="min-w-0">
                    <p lang="en" className="font-serif text-[17px] leading-[1.25] text-text lg:text-[26px] lg:leading-[1.2]">
                      {l.card.name}
                    </p>
                    <p lang="en" className="mt-2 font-mono text-[11px] leading-snug text-muted">
                      {tileMeta(l)}
                    </p>
                  </div>
                  <div className="shrink-0 lg:text-right">
                    <TilePrice l={l} locale={locale} big />
                    <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
                      {t('lastOne')}
                    </p>
                  </div>
                </div>
              </Link>
            ) : (
              <Link
                key={l.inventoryItemId}
                href={`/catalog/${l.card.id}`}
                className="w-[160px] shrink-0 snap-start lg:w-[268px]"
              >
                <CardImage src={l.card.imageSmallUrl} alt={l.card.name} />
                <div className="mt-3 flex items-baseline gap-2 lg:mt-[15px]">
                  <span className="font-mono text-[10px] leading-none text-accent">
                    {String(i).padStart(2, '0')}
                  </span>
                  <p lang="en" className="font-serif text-sm leading-[1.3] text-text lg:text-base">
                    {l.card.name}
                  </p>
                </div>
                <p lang="en" className="mt-1.5 font-mono text-[11px] leading-snug text-muted">
                  {tileMeta(l)}
                </p>
                <TilePrice l={l} locale={locale} />
                <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
                  {t('lastOne')}
                </p>
              </Link>
            ),
          )}
        </div>
      )}
    </section>
  );
}
