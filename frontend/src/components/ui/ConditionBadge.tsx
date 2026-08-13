'use client';

import { ShieldCheck } from 'lucide-react';
import { Badge } from './Badge';
import type { ProductType, RawCondition, GradingCompany } from '@/types/contract';

export interface ConditionBadgeProps {
  productType: ProductType;
  rawCondition?: RawCondition;
  gradingCompany?: GradingCompany;
  gradeValue?: string;
}

/** Badge de condición/grado derivado de productType (DESIGN_SYSTEM §7.1). */
export function ConditionBadge({ productType, rawCondition, gradingCompany, gradeValue }: ConditionBadgeProps) {
  if (productType === 'graded') {
    return (
      <Badge tone="accent" shape="soft" icon={<ShieldCheck size={13} aria-hidden />}>
        {gradingCompany} {gradeValue}
      </Badge>
    );
  }
  if (productType === 'sealed') {
    return (
      <Badge tone="info" shape="soft">
        Sealed
      </Badge>
    );
  }
  const tone = rawCondition === 'DMG' || rawCondition === 'HP' ? 'warning' : 'neutral';
  return (
    <Badge tone={tone} shape="outline">
      {rawCondition}
    </Badge>
  );
}
