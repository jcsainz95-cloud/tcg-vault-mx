'use client';

import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import type { Finish, ProductType } from '@/types/contract';
import { Badge } from '@/components/ui/Badge';

export interface FinishBadgeProps {
  finish: Finish;
  productType?: ProductType;
  compact?: boolean;
}

/**
 * v1.6-finish: muestra el acabado/versión de una carta (Normal / Reverse Holo / Holofoil /
 * 1st Edition). El acabado solo aplica a raw/singles; para graded/sealed es siempre `normal`
 * y se oculta (no aporta señal). Dos copias con acabado distinto son listings separados.
 */
export function FinishBadge({ finish, productType, compact }: FinishBadgeProps) {
  const t = useTranslations('finish');
  // graded/sealed → normal siempre: no lo mostramos (ruido). raw sí muestra su acabado.
  const meaningful = productType == null ? true : productType === 'raw' || finish !== 'normal';
  if (!meaningful) return null;
  return (
    <Badge
      tone={finish === 'normal' ? 'neutral' : 'accent'}
      icon={finish === 'normal' ? undefined : <Sparkles size={compact ? 11 : 12} aria-hidden />}
    >
      <span className="sr-only">{t('label')}: </span>
      {t(finish)}
    </Badge>
  );
}
