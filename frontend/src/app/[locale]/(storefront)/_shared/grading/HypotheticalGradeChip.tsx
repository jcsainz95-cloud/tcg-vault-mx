'use client';

import { useTranslations } from 'next-intl';

/**
 * Chip de grado **hipotético** (DESIGN_SYSTEM §22.2) — variante sin cert del chip de grado ya
 * ratificado. Un solo diferenciador frente al grado REAL de un slab: el **borde punteado**
 * (`border-dashed`), que en este sistema significa «valor no realizado» (mismo recurso que el costo
 * base del `PortfolioTrendChart`). El borde continuo de tinta significa *verificable*; el punteado,
 * *hipotético*. Es un canal NO cromático: no añade ningún token de color.
 *
 * Nunca lleva `certNumber` (no hay slab que consultar) y nunca aparece solo: siempre precedido del
 * condicional «SI SALE» de la etiqueta de su celda. En la teja NO se usa (a 171px el punteado no
 * lee): ahí el grado es texto mono plano dentro de la frase condicional (§22.5).
 */
export function HypotheticalGradeChip({
  gradingCompany,
  gradeValue,
}: {
  gradingCompany: string;
  gradeValue: string;
}) {
  const t = useTranslations('catalog.gradingEstimate');
  const label = `${gradingCompany} ${gradeValue}`.trim();
  return (
    <span className="inline-flex shrink-0 items-center border border-dashed border-border-strong px-[7px] py-1 font-mono text-[10px] font-medium leading-none tracking-[0.1em] text-text">
      <span aria-hidden className="tabular">
        {label}
      </span>
      {/* El grado se ANUNCIA como hipotético (§22.9): «Grado hipotético: PSA 10. Esta carta no
          está gradeada.» — evita el peor malentendido posible (creer que viene en slab). */}
      <span className="sr-only">
        {t('hypotheticalGradeAria', { company: gradingCompany, grade: gradeValue })}
      </span>
    </span>
  );
}
