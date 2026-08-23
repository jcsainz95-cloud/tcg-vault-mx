'use client';

import { useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import type { AppLocale } from '@/i18n/routing';
import type { SealedGroupKind, SealedProductDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Paso 1 del alta de sellado — DOS SECCIONES por `origin` (DESIGN_SYSTEM §16.8a, P-38). Reemplaza el
 * grid único de P-35 (`SealedProductGrid`). El campo `origin` de cada `SealedProductDTO` particiona la
 * lista en «Del set» (`set_main`, primero) y «Promos/colecciones» (`promo_collection`, después). Cada
 * sección es un `<section>` con `<h3>` real + su propio `role="listbox"`; la selección es ÚNICA en todo
 * el paso (un solo `sealedProductId` viaja al paso 2). El orden interno lo entrega el servidor (§4.34c:
 * principales primero). Money-safe por teja: precio de mercado o pill «SIN PRECIO DE MERCADO», NUNCA 0.
 */

export interface SealedProductPickerProps {
  data: SealedProductDTO[];
  setName: string;
  selectedId: string | null;
  onSelect: (product: SealedProductDTO) => void;
  /** Enter en una teja avanza directo al paso 2. */
  onConfirm?: (product: SealedProductDTO) => void;
  /** Slot bajo la sección «Promos/colecciones» cuando está vacía (curación — solo super_admin). */
  promoEmptySlot?: React.ReactNode;
}

const ORDER: SealedGroupKind[] = ['set_main', 'promo_collection'];

export function SealedProductPicker({
  data,
  setName,
  selectedId,
  onSelect,
  onConfirm,
  promoEmptySlot,
}: SealedProductPickerProps) {
  const t = useTranslations('admin.sealedAdd');

  const bySection = useMemo(() => {
    const map: Record<SealedGroupKind, SealedProductDTO[]> = {
      set_main: [],
      promo_collection: [],
    };
    for (const p of data) map[p.origin].push(p);
    return map;
  }, [data]);

  return (
    <div className="flex flex-col gap-6">
      {ORDER.map((origin) => (
        <SealedSection
          key={origin}
          origin={origin}
          products={bySection[origin]}
          setName={setName}
          selectedId={selectedId}
          onSelect={onSelect}
          onConfirm={onConfirm}
          heading={origin === 'set_main' ? t('section.fromSet') : t('section.promoCollection')}
          subcopy={
            origin === 'set_main'
              ? t('section.fromSetSub', { set: setName })
              : t('section.promoCollectionSub')
          }
          ariaLabel={origin === 'set_main' ? t('section.fromSet') : t('section.promoCollection')}
          emptyLabel={t('sectionEmpty')}
          emptySlot={origin === 'promo_collection' ? promoEmptySlot : undefined}
        />
      ))}
    </div>
  );
}

function SealedSection({
  origin,
  products,
  setName,
  selectedId,
  onSelect,
  onConfirm,
  heading,
  subcopy,
  ariaLabel,
  emptyLabel,
  emptySlot,
}: {
  origin: SealedGroupKind;
  products: SealedProductDTO[];
  setName: string;
  selectedId: string | null;
  onSelect: (p: SealedProductDTO) => void;
  onConfirm?: (p: SealedProductDTO) => void;
  heading: string;
  subcopy: string;
  ariaLabel: string;
  emptyLabel: string;
  emptySlot?: React.ReactNode;
}) {
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
    <section className="flex flex-col gap-3" aria-label={ariaLabel}>
      <div className="flex flex-col gap-0.5">
        <h3 className="eyebrow flex items-center gap-2">
          <span>{heading}</span>
          <span className="font-mono tabular-nums text-muted">· {products.length}</span>
        </h3>
        <p className="text-xs text-muted">{subcopy}</p>
      </div>

      {products.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
            {emptyLabel}
          </p>
          {emptySlot}
        </div>
      ) : (
        <div
          ref={containerRef}
          role="listbox"
          aria-label={t('gridLabel', { set: setName })}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        >
          {products.map((p, i) => (
            <SealedProductTile
              key={p.id}
              product={p}
              selected={selectedId === p.id}
              locale={locale}
              subtypeLabel={tSub(p.subtype)}
              inferredTitle={t('subtypeInferredHint')}
              principalLabel={t('principalBadge')}
              noMarketLabel={t('noMarket')}
              marketSuffix={t('marketRef')}
              onSelect={() => onSelect(p)}
              onKeyDown={(e) => onKeyDown(e, i)}
            />
          ))}
        </div>
      )}
      {/* origin usado como key semántico; evita lint de variable sin uso en algún linter. */}
      <span hidden data-origin={origin} />
    </section>
  );
}

export function SealedProductTile({
  product,
  selected,
  locale,
  subtypeLabel,
  inferredTitle,
  principalLabel,
  noMarketLabel,
  marketSuffix,
  onSelect,
  onKeyDown,
}: {
  product: SealedProductDTO;
  selected: boolean;
  locale: AppLocale;
  subtypeLabel: string;
  inferredTitle: string;
  principalLabel: string;
  noMarketLabel: string;
  marketSuffix: string;
  onSelect: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const name = product.cleanName ?? product.name;
  const refCents =
    product.marketRef?.status === 'priced' ? product.marketRef.referenceMxnCents ?? null : null;
  // a11y: la etiqueta resume producto + subtipo + principal + estado de mercado (§16.8a).
  const ariaLabel = [
    name,
    subtypeLabel,
    product.isPrincipal ? principalLabel : undefined,
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
        {product.isPrincipal && (
          <span className="absolute left-1 top-1 border border-border-strong bg-bg/80 px-1 font-mono text-[10px] uppercase tracking-[0.06em] text-text">
            {principalLabel}
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

      <span
        className="w-fit border border-info px-1 font-mono text-[10px] uppercase tracking-[0.06em] text-info"
        title={product.subtypeInferred ? inferredTitle : undefined}
      >
        {subtypeLabel}
        {product.subtypeInferred && (
          <span aria-hidden className="ml-0.5 opacity-50">
            ·
          </span>
        )}
      </span>

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

/** Skeleton del paso 1: dos secciones con su retícula final (pozo + 2 barras), no spinner (§18.6). */
export function SealedProductPickerSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      {[0, 1].map((s) => (
        <div key={s} className="flex flex-col gap-3">
          <Skeleton className="h-4 w-40" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: s === 0 ? 4 : 2 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2 border border-border p-2">
                <Skeleton className="aspect-[5/7] w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
