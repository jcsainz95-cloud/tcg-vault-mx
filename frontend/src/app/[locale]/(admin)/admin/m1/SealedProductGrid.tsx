'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import type { AppLocale } from '@/i18n/routing';
import type { SealedCatalogProductDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Grid de PRODUCTOS SELLADOS de un set — P-35 (DESIGN_SYSTEM §16.8a). El corazón del fix: tejas de
 * PRODUCTO (ETB, booster box, bundle…) con imagen + nombre reales de la fuente TCGCSV, NO singles.
 * `role="listbox"` con `role="option"`s navegables por flechas + Home/End, foco visible, aria-selected.
 * Money-safe por teja: precio de mercado o pill «SIN PRECIO DE MERCADO» — NUNCA MX$ 0.00.
 */

export interface SealedProductGridProps {
  products: SealedCatalogProductDTO[];
  setName: string;
  selectedId: number | null;
  onSelect: (product: SealedCatalogProductDTO) => void;
  /** Enter en una teja avanza directo al paso 2. */
  onConfirm?: (product: SealedCatalogProductDTO) => void;
}

export function SealedProductGrid({
  products,
  setName,
  selectedId,
  onSelect,
  onConfirm,
}: SealedProductGridProps) {
  const t = useTranslations('admin.sealedAdd');
  const tSub = useTranslations('status.sealedSubtype');
  const locale = useLocale() as AppLocale;
  const containerRef = useRef<HTMLDivElement>(null);

  function focusTile(index: number) {
    const tiles = containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    if (!tiles) return;
    const clamped = Math.max(0, Math.min(tiles.length - 1, index));
    tiles[clamped]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    // 2→3→4 columnas según viewport: para la navegación por flechas basta ±1 y Home/End (lineal,
    // predecible en cualquier densidad; §16.8a exige flechas + Home/End sin trampa de foco).
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        focusTile(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        focusTile(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusTile(0);
        break;
      case 'End':
        e.preventDefault();
        focusTile(products.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onSelect(products[index]);
        if (e.key === 'Enter') onConfirm?.(products[index]);
        break;
    }
  }

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label={t('gridLabel', { set: setName })}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
    >
      {products.map((p, i) => (
        <SealedProductTile
          key={p.tcgplayerProductId}
          product={p}
          selected={selectedId === p.tcgplayerProductId}
          locale={locale}
          subtypeLabel={p.sealedSubtype ? tSub(p.sealedSubtype) : null}
          noMarketLabel={t('noMarket')}
          marketSuffix={t('marketRef')}
          onSelect={() => onSelect(p)}
          onKeyDown={(e) => onKeyDown(e, i)}
        />
      ))}
    </div>
  );
}

function SealedProductTile({
  product,
  selected,
  locale,
  subtypeLabel,
  noMarketLabel,
  marketSuffix,
  onSelect,
  onKeyDown,
}: {
  product: SealedCatalogProductDTO;
  selected: boolean;
  locale: AppLocale;
  subtypeLabel: string | null;
  noMarketLabel: string;
  marketSuffix: string;
  onSelect: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const name = product.cleanName ?? product.name;
  const refCents =
    product.marketRef?.status === 'priced' ? product.marketRef.referenceMxnCents ?? null : null;
  // a11y: la etiqueta de la teja resume producto + subtipo + estado de mercado (§16.8a).
  const ariaLabel = [
    name,
    subtypeLabel ?? undefined,
    refCents != null ? formatMoneyCents(refCents, locale) : noMarketLabel,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={ariaLabel}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={`flex flex-col gap-2 border p-2 text-left focus-visible:shadow-focus focus-visible:outline-none ${
        selected ? 'border-border-strong bg-surface-2' : 'border-border hover:bg-surface-2/50'
      }`}
    >
      {/* Pozo de imagen: las cajas son más cuadradas que una carta → object-contain, no se recortan. */}
      <div className="relative flex aspect-[5/7] w-full items-center justify-center overflow-hidden bg-surface-2">
        {product.imageUrl && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={name}
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-contain"
          />
        ) : (
          // Fallback honesto: nombre en mono centrado, jamás un roto.
          <span lang="en" className="px-2 text-center font-mono text-[11px] leading-tight text-muted">
            {name}
          </span>
        )}
        {selected && (
          <span
            aria-hidden
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center bg-primary text-primary-fg"
          >
            <Check size={14} />
          </span>
        )}
      </div>

      <span lang="en" className="line-clamp-2 text-sm font-medium text-text">
        {name}
      </span>

      {subtypeLabel && (
        <span className="w-fit border border-info px-1 font-mono text-[10px] uppercase tracking-[0.06em] text-info">
          {subtypeLabel}
        </span>
      )}

      {/* Referencia de mercado money-safe: precio o pill; NUNCA MX$ 0.00. */}
      {refCents != null ? (
        <span className="font-mono tabular-nums text-xs text-muted">
          {formatMoneyCents(refCents, locale)}{' '}
          <span className="uppercase tracking-[0.06em]">{marketSuffix}</span>
        </span>
      ) : (
        <span className="w-fit border border-accent px-1 font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
          {noMarketLabel}
        </span>
      )}
    </button>
  );
}

/** Skeleton del grid (paso 1): retícula final (pozo + 2 barras), no spinner (§18.6). */
export function SealedProductGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 border border-border p-2">
          <Skeleton className="aspect-[5/7] w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
