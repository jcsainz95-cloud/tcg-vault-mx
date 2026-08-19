'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ProductType } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { hasManualPrice } from '@/lib/inventory';
import { Badge } from '@/components/ui/Badge';

export interface ManualPriceBadgeProps {
  /** Pieza (o subconjunto): basta `productType` + `listPriceCents` para decidir. */
  item: { productType: ProductType; listPriceCents?: number | null };
  /** Muestra el monto del override bajo el badge (apoyo en la lista); en el detalle no hace falta. */
  showAmount?: boolean;
}

/**
 * INV-3: indicador SOBRIO de "precio manual" (override que ignora las reglas de precio globales).
 * Badge neutral/outline (versalitas mono, regla de 1px — nada llamativo). El hint accesible sigue el
 * patrón del design system (§7.2b: la señal se EXPLICA, no se cifra): el badge es FOCUSEABLE por
 * teclado (`tabIndex={0}` → el `Badge` pinta `cursor-help` + anillo de foco visible) y la explicación
 * viaja como texto `sr-only` DENTRO del badge (parte de su nombre accesible) + `title` para el hover
 * del ratón — sin `aria-label` redundante sobre un span no interactivo.
 *
 * Solo renderiza cuando `hasManualPrice(item)` (espeja el motor: sellado exige override `> 0`).
 * Compartido por la lista (M1View) y el detalle (ItemDetailModal) para no duplicar el markup.
 */
export function ManualPriceBadge({ item, showAmount }: ManualPriceBadgeProps) {
  const t = useTranslations('admin.m1');
  const locale = useLocale() as AppLocale;
  if (!hasManualPrice(item)) return null;

  const badge = (
    <Badge tone="neutral" shape="outline" tabIndex={0} title={t('manualPriceBadgeHint')}>
      {t('manualPriceBadge')}
      {/* Segundo canal accesible: la explicación completa, leída por lectores de pantalla. */}
      <span className="sr-only"> — {t('manualPriceBadgeHint')}</span>
    </Badge>
  );

  if (!showAmount) return badge;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      {badge}
      {/* `hasManualPrice` garantiza `listPriceCents` presente (y `> 0` en sellado). */}
      <span className="tabular text-xs text-muted">{formatMoneyCents(item.listPriceCents!, locale)}</span>
    </span>
  );
}
