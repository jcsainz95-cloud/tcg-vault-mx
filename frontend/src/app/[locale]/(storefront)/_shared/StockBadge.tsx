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
 * | `unique`   | «Queda 1»    | accent — pieza única (1 pub = 1 copia) |
 * | `count`    | «N en stock» | success — conteo agregado REAL (sellado) |
 * | `lastUnit` | «Último»     | muted — última unidad de un producto que tuvo varias |
 * | `soldOut`  | «Agotado»    | muted — grupo sin unidades vendibles |
 *
 * Regla money-safe (§20.6, dura): `count`/`lastUnit`/`soldOut` SOLO con conteos
 * reales del backend (hoy: `availableCount` del sellado); `unique` es el literal
 * honesto de singles. El texto es el portador; el color es redundante (§2.4).
 * Mono 10px (9px en móvil), uppercase, tracking 0.12em, sin caja.
 */
export type StockBadgeVariant = 'unique' | 'count' | 'lastUnit' | 'soldOut';

/** Mapea un conteo agregado REAL (sellado) a su variante: 0=agotado, 1=último, N=en stock. */
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
