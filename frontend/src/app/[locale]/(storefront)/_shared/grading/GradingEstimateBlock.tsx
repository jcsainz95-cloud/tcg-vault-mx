'use client';

import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { GroupedListingDetailResponse } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatDate, formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Fact } from '../Fact';
import { blockEstimatesOf, oldestCapturedDate } from './estimates';
import { useGradingFootnote } from './GradingFootnote';
import { GradingMicroNotice } from './GradingMicroNotice';
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
 *  - **R3**: micro-aviso VISIBLE + llamada + nota al pie, las tres bajo la MISMA condición. Sin nota
 *    al pie en la página (contexto ausente) el bloque **no se pinta**.
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

  const captured = oldestCapturedDate(items);
  const capturedLabel = captured ? formatDate(captured, locale) : undefined;

  return (
    <section aria-labelledby={eyebrowId} className={cn('border-t border-text', className)}>
      {/* Eyebrows enfrentados (§20.2.1). La LLAMADA ya NO vive aquí: cierra el micro-aviso de
          abajo (§21.4a, corrección de QA) — es lo que convierte el aviso en «hay más abajo». */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-4">
        <h2 id={eyebrowId} className="eyebrow">
          {t('eyebrow')}
        </h2>
        {capturedLabel && <span className="eyebrow">{t('updatedAt', { date: capturedLabel })}</span>}
      </div>

      {/* Misma retícula de dos columnas de la ficha; en móvil las celdas apilan solas (Fact).
          §21.7: con UNA sola cifra la retícula COLAPSA a una columna a ancho completo — nada de
          media retícula vacía ni de un `border-b` a mitad de ancho. */}
      <div
        className={cn('grid', items.length > 1 && 'sm:grid-cols-2')}
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

      {/* MICRO-AVISO (R3.1, §21.4c) — sustituye al viejo «renglón de procedencia», que cargaba la
          idea 2 pero NO la idea 1 y por eso no cumplía §N.5. Aquí cabe la versión corta completa:
          de dónde sale la cifra (inciso), que es ILUSTRATIVA y que NO evaluamos esta carta. */}
      <GradingMicroNotice
        namespace="catalog.gradingEstimate"
        className="mt-3 max-w-[560px] text-[12px] leading-[1.6]"
      />
    </section>
  );
}
