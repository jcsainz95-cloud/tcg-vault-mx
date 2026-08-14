'use client';

import { useTranslations } from 'next-intl';
import { ShieldCheck, Package } from 'lucide-react';
import { Badge } from './Badge';
import type { ProductType, RawCondition, GradingCompany, SealedSubtype } from '@/types/contract';

export interface ConditionBadgeProps {
  productType: ProductType;
  rawCondition?: RawCondition;
  sealedSubtype?: SealedSubtype;
  gradingCompany?: GradingCompany;
  gradeValue?: string;
  /** en contenedores muy estrechos colapsa el texto a la pill "NM" (aria-label completo) */
  compact?: boolean;
}

/**
 * Badge de condición/grado/tipo (DESIGN_SYSTEM §7.2b, v1.1).
 * - raw: SOLO NM → "Casi nueva (NM)" / "Near Mint (NM)", tono success suave,
 *   descripción del estándar en tooltip (`title`) + `aria-label`, badge focuseable.
 * - graded: PSA 10 / CGC 9.5 (accent).
 * - sealed: "Sellado / Sealed" (info) + subtipo (badge secundario).
 */
export function ConditionBadge({
  productType,
  rawCondition,
  sealedSubtype,
  gradingCompany,
  gradeValue,
  compact,
}: ConditionBadgeProps) {
  const t = useTranslations();

  if (productType === 'graded') {
    return (
      <Badge tone="accent" shape="soft" icon={<ShieldCheck size={13} aria-hidden />}>
        {gradingCompany} {gradeValue}
      </Badge>
    );
  }

  if (productType === 'sealed') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <Badge tone="info" shape="soft" icon={<Package size={13} aria-hidden />}>
          {t('card.productType.sealed')}
        </Badge>
        {sealedSubtype && (
          <Badge tone="neutral" shape="soft">
            {t(`status.sealedSubtype.${sealedSubtype}`)}
          </Badge>
        )}
      </span>
    );
  }

  // raw → único valor NM (v1.1). Nombre legible + descripción del estándar.
  const label = t('catalog.condition.nm.label');
  const desc = t('catalog.condition.nm.desc');
  const ariaLabel = `${t('card.condition')}: ${label}. ${desc}`;
  return (
    <Badge
      tone="success"
      shape="soft"
      icon={<ShieldCheck size={13} aria-hidden />}
      tabIndex={0}
      title={`${label} — ${desc}`}
      aria-label={ariaLabel}
    >
      {compact ? 'NM' : label}
    </Badge>
  );
}
