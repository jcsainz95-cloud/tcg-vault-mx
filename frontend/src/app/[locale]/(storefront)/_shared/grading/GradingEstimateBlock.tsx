'use client';

import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { GroupedListingDetailResponse } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatDate, formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Fact } from '../Fact';
import { blockEstimatesOf, latestCapturedDate } from './estimates';
import { GradingNoteCall, useGradingFootnote } from './GradingFootnote';
import { HypotheticalGradeChip } from './HypotheticalGradeChip';

/**
 * `GradingEstimateBlock` — bloque de la FICHA (DESIGN_SYSTEM §21.3). Dos cifras de referencia junto
 * al precio. Nada más.
 *
 * Reglas duras que este componente implementa:
 *  - **R2, las dos voces del dinero**: el precio de venta es sans 500 a 30px; estos estimados son
 *    **mono tabular**, más chicos (22/17px, 20/16 en móvil) y viven en un contenedor APARTE con su
 *    propia regla de tinta. **El bloque no contiene ningún precio real**: ni repetido, ni citado, ni
 *    tachado. Y nunca entra en la retícula de precio existente (mismo grid = misma categoría).
 *  - **R1, cero tokens nuevos**: las cifras van en tinta (`text-text`) y las etiquetas en muted. El
 *    único elemento con acento es la llamada `*`.
 *  - **R3**: sin nota al pie en la página (contexto ausente) el bloque **no se pinta**.
 *  - **R4**: sin dato, no hay contenedor, ni encabezado, ni regla huérfana, ni skeleton.
 *  - **R5**: aquí no hay multiplicador, ganancia, costo de gradeo ni margen — ni cifra ni palabra.
 *
 * Se **itera** el arreglo leyendo `gradeValue`: el número de celdas lo decide el servidor. La
 * jerarquía la carga la POSICIÓN (la primera cifra es el premio mayor, §N.3), no un grado
 * cableado — añadir o quitar un grado no toca este archivo.
 */
export function GradingEstimateBlock({
  detail,
  className,
}: {
  detail: Pick<GroupedListingDetailResponse, 'listings' | 'gradedEstimates'> | undefined;
  className?: string;
}) {
  const t = useTranslations('catalog.gradingEstimate');
  const locale = useLocale() as AppLocale;
  const anchors = useGradingFootnote();
  const eyebrowId = useId();

  const items = blockEstimatesOf(detail);
  // R3.(3) + R4: sin nota que hospede la cifra, o sin cifra, no se renderiza NADA.
  if (!anchors || !items) return null;

  const captured = latestCapturedDate(items);
  const capturedLabel = captured ? formatDate(captured, locale) : undefined;

  return (
    <section aria-labelledby={eyebrowId} className={cn('border-t border-text', className)}>
      {/* Eyebrows enfrentados (§20.2.1): la LLAMADA vive en el izquierdo, pegada a la ETIQUETA
          del gancho — no se repite por cifra (§21.4a). */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-4">
        <h2 id={eyebrowId} className="eyebrow">
          {t('eyebrow')}
          <GradingNoteCall variant="link" />
        </h2>
        {capturedLabel && <span className="eyebrow">{t('updatedAt', { date: capturedLabel })}</span>}
      </div>

      {/* Misma retícula de dos columnas de la ficha; en móvil las celdas apilan solas (Fact). */}
      <div
        className="grid sm:grid-cols-2"
        // Asociación redundante para que la ayuda técnica pueda leer el aviso completo desde la
        // cifra, sin navegar (§21.9).
        aria-describedby={anchors.noteId}
      >
        {items.map((e, i) => (
          <Fact
            key={e.gradeKey || `${e.gradingCompany}:${e.gradeValue}`}
            className={cn(i > 0 && 'sm:border-l sm:pl-7')}
            label={
              <span className="flex flex-wrap items-center gap-2">
                {t('ifGradesLabel')}
                <HypotheticalGradeChip gradingCompany={e.gradingCompany} gradeValue={e.gradeValue} />
              </span>
            }
          >
            <span
              className={cn(
                'tabular block whitespace-nowrap font-mono leading-none text-text',
                // La primera cifra es el premio mayor (§N.3): un escalón DENTRO de la misma
                // categoría, no un salto de voz. El resto comparte el tamaño menor.
                i === 0 ? 'text-[20px] sm:text-[22px]' : 'text-[16px] sm:text-[17px]',
              )}
            >
              {formatMoneyCents(e.estimate.referenceMxnCents!, locale)}
            </span>
          </Fact>
        ))}
      </div>

      {/* Renglón de procedencia: de dónde sale la cifra Y que no evaluamos esta pieza (§21.3). */}
      <p className="mt-3 max-w-[560px] font-mono text-[11px] leading-[1.5] text-muted">
        {t('provenance')}
      </p>
    </section>
  );
}
