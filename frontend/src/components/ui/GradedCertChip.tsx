'use client';

import { useTranslations } from 'next-intl';
import { Badge } from './Badge';
import type { GradingCompany } from '@/types/contract';

export interface GradedCertChipProps {
  gradingCompany?: GradingCompany;
  gradeValue?: string;
  /** nº de certificado PSA/CGC (ListingDTO.certNumber). */
  certNumber?: string;
  /**
   * scrim: chip opaco de tinta para montar SOBRE el arte (§7.2b regla 2). En la
   * dirección 5a el catálogo ya no monta nada sobre la carta —el dato vive en el
   * renglón mono de abajo (ListingSpec)— pero se conserva para quien lo necesite.
   */
  variant?: 'soft' | 'scrim';
  /** puede colapsar a "PSA 10" sin el certNumber (aria-label completo). */
  compact?: boolean;
}

/**
 * Chip de gradeada — empresa + grado + certificado (DESIGN_SYSTEM §7.2c, v1.2).
 * Formato canónico: `PSA 10 · #12345678`. La condición de una gradeada NO depende
 * de foto: el slab (empresa+grado+cert, verificable en la graduadora) es la garantía.
 */
export function GradedCertChip({
  gradingCompany,
  gradeValue,
  certNumber,
  variant = 'soft',
  compact,
}: GradedCertChipProps) {
  const t = useTranslations('card');
  const gradeLabel = `${gradingCompany ?? ''} ${gradeValue ?? ''}`.trim();
  const showCert = !!certNumber && !compact;
  const ariaLabel = certNumber
    ? t('gradedCertAria', { company: gradingCompany ?? '', grade: gradeValue ?? '', cert: certNumber })
    : gradeLabel;

  const content = (
    <span className="tabular">
      {gradeLabel}
      {showCert && <span> · #{certNumber}</span>}
    </span>
  );

  if (variant === 'scrim') {
    // Tinta sólida + papel: contraste AA independiente del arte que tenga detrás.
    return (
      <span
        className="inline-flex items-center bg-ink px-2 py-1 font-mono text-[11px] uppercase leading-none tracking-[0.06em] text-on-ink"
        aria-label={ariaLabel}
      >
        {content}
      </span>
    );
  }

  return (
    <Badge tone="primary" shape="soft" aria-label={ariaLabel}>
      {content}
    </Badge>
  );
}
