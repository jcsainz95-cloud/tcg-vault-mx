'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type { Finish, GradingCompany, ProductType, RawCondition, SealedSubtype } from '@/types/contract';

export interface ListingSpecProps {
  productType: ProductType;
  rawCondition?: RawCondition;
  sealedSubtype?: SealedSubtype;
  finish: Finish;
  gradingCompany?: GradingCompany;
  gradeValue?: string;
  certNumber?: string;
  /** oculta el nº de certificado en contenedores estrechos (móvil, renglones) */
  compact?: boolean;
  className?: string;
}

/**
 * Ficha técnica de una copia como un solo renglón mono: `RAW · NM · HOLOFOIL`,
 * `GRADED · PSA 9 · CERT 84213307`, `SELLADO · ETB`.
 *
 * Dirección 5a: sustituye a la fila de pastillas (ConditionBadge + FinishBadge +
 * GradedCertChip) del catálogo y de la bóveda. Un solo renglón se lee más rápido
 * y no compite con el arte, que es lo que debe mandar en la retícula.
 * ConditionBadge sigue existiendo para donde el dato necesita su propio hueco
 * (ficha de detalle), no para las retículas.
 */
export function ListingSpec({
  productType,
  rawCondition,
  sealedSubtype,
  finish,
  gradingCompany,
  gradeValue,
  certNumber,
  compact,
  className,
}: ListingSpecProps) {
  const t = useTranslations();
  const parts: string[] = [t(`card.productType.${productType}`)];
  /*
   * El renglón abrevia la condición a "NM" para no romper la retícula, así que el
   * estándar legible viaja en title/aria-label (DESIGN_SYSTEM §7.2b: la condición
   * se explica, no se cifra en una sigla). La etiqueta completa se pinta en la
   * ficha de detalle, que sí tiene hueco para ella.
   */
  const nmTooltip =
    productType === 'raw'
      ? `${t('catalog.condition.nm.label')} — ${t('catalog.condition.nm.desc')}`
      : undefined;

  if (productType === 'graded') {
    const grade = `${gradingCompany ?? ''} ${gradeValue ?? ''}`.trim();
    if (grade) parts.push(grade);
    if (certNumber && !compact) parts.push(`${t('card.certLabel')} ${certNumber}`);
  } else if (productType === 'sealed') {
    if (sealedSubtype) parts.push(t(`status.sealedSubtype.${sealedSubtype}`));
  } else {
    // raw: NM es el único valor del contrato (v1.1) y es término de grading, no se traduce.
    if (rawCondition) parts.push(rawCondition);
    parts.push(t(`finish.${finish}`));
  }

  const line = parts.join(' · ');
  return (
    <p
      title={nmTooltip}
      aria-label={nmTooltip ? `${line}. ${nmTooltip}` : undefined}
      className={cn(
        'font-mono text-[11px] uppercase leading-none tracking-[0.08em] text-text',
        className,
      )}
    >
      {line}
    </p>
  );
}
