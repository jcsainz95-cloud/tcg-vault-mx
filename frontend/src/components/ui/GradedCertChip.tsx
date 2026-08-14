'use client';

import { useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import { Badge } from './Badge';
import { cn } from '@/lib/cn';
import type { GradingCompany } from '@/types/contract';

export interface GradedCertChipProps {
  gradingCompany?: GradingCompany;
  gradeValue?: string;
  /** nº de certificado PSA/CGC (ListingDTO.certNumber). */
  certNumber?: string;
  /**
   * scrim: chip sólido de alto contraste para montar SOBRE el arte (§7.2b regla 2:
   * fondo slate-900/90, texto blanco, top-2 left-2). Por defecto (soft) es el
   * Badge accent estándar para la fila de info bajo la imagen.
   */
  variant?: 'soft' | 'scrim';
  /** en el arte puede colapsar a "PSA 10" sin el certNumber (aria-label completo). */
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

  if (variant === 'scrim') {
    // Chip opaco slate-900/90 + texto blanco: AA/AAA independiente del arte (§7.2b).
    return (
      <span
        className="inline-flex items-center gap-1 rounded-[6px] bg-slate-900/90 px-2 py-0.5 text-xs font-semibold text-white shadow-[0_1px_2px_rgba(15,23,42,.06)]"
        aria-label={ariaLabel}
      >
        <ShieldCheck size={13} aria-hidden />
        <span className="tabular-nums">
          {gradeLabel}
          {showCert && <span className="font-normal"> · #{certNumber}</span>}
        </span>
      </span>
    );
  }

  return (
    <Badge tone="accent" shape="soft" icon={<ShieldCheck size={13} aria-hidden />} aria-label={ariaLabel}>
      <span className={cn('tabular-nums')}>
        {gradeLabel}
        {showCert && <span className="font-normal"> · #{certNumber}</span>}
      </span>
    </Badge>
  );
}
