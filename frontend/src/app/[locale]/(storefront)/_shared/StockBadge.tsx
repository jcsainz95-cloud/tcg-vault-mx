'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/**
 * Distintivo de stock ÚNICO del storefront (DESIGN_SYSTEM §20.6) — R1 del pase
 * de refactors del makeover 1a. API semántica por variante (el caller declara
 * QUÉ significa el dato, el badge decide el color canónico del DS):
 *
 * | variante   | texto        | color canónico (§20.6)          |
 * |------------|--------------|---------------------------------|
 * | `unique`   | «Queda 1»    | accent — queda 1 disponible ahora (single: 1 pub=1 copia o grupo con stock 1) |
 * | `count`    | «N en stock» | success — conteo agregado REAL (N≥2 copias equivalentes) |
 * | `lastUnit` | «Último»     | muted — última unidad de un producto SELLADO que tuvo varias (§20.6) |
 * | `soldOut`  | «Agotado»    | muted — grupo sin unidades vendibles |
 *
 * Regla money-safe (§20.6, dura): todas las variantes se derivan de conteos
 * reales del backend (`stockCount` del grupo de singles P-30, `availableCount`
 * del sellado). El texto es el portador; el color es redundante (§2.4).
 * Mono 10px (9px en móvil), uppercase, tracking 0.12em, sin caja.
 *
 * `count===1` diverge por familia (§20.6): en **singles** significa «queda 1
 * disponible ahora» → `unique` («Queda 1»); en **sellado** significa «última de
 * varias» → `lastUnit` («Último»). De ahí los dos mapeadores de abajo.
 */
export type StockBadgeVariant = 'unique' | 'count' | 'lastUnit' | 'soldOut';

/**
 * Mapea el stock REAL de un grupo de SINGLES (P-30, agrupado por variante
 * equivalente) a su variante: 0=agotado, 1=«Queda 1» (§20.6 — `stockCount===1`
 * es «1 disponible ahora mismo», no «última de varias»), N≥2=«N en stock».
 */
export function stockVariantForSingle(count: number): StockBadgeVariant {
  return count === 0 ? 'soldOut' : count === 1 ? 'unique' : 'count';
}

/** Mapea un conteo agregado REAL de SELLADO a su variante: 0=agotado, 1=último, N=en stock (§20.6). */
export function stockVariantFromCount(count: number): StockBadgeVariant {
  return count === 0 ? 'soldOut' : count === 1 ? 'lastUnit' : 'count';
}

const TONE: Record<StockBadgeVariant, string> = {
  unique: 'text-accent',
  count: 'text-success',
  lastUnit: 'text-muted',
  soldOut: 'text-muted',
};

export function StockBadge({
  variant,
  count,
  className,
}: {
  variant: StockBadgeVariant;
  /** Solo para `variant="count"`: el conteo agregado real del backend. */
  count?: number;
  className?: string;
}) {
  const t = useTranslations('stock');
  const label =
    variant === 'unique'
      ? t('lastOne')
      : variant === 'count'
        ? t('inStock', { count: count ?? 0 })
        : variant === 'lastUnit'
          ? t('lastUnit')
          : t('soldOut');
  return (
    <p
      className={cn(
        'tabular font-mono text-[9px] uppercase leading-none tracking-[0.12em] sm:text-[10px]',
        TONE[variant],
        className,
      )}
    >
      {label}
    </p>
  );
}
