'use client';

import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { GroupedListingDetailResponse } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Fact } from '../Fact';
import { blockEstimatesOf } from './estimates';
import { useGradingFootnote } from './GradingFootnote';
import { GradingMicroNotice } from './GradingMicroNotice';
import { HypotheticalGradeChip } from './HypotheticalGradeChip';

/**
 * `GradingEstimateBlock` — bloque de la FICHA (DESIGN_SYSTEM §22.3). Dos cifras de referencia junto
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
 * jerarquía la carga la POSICIÓN (la primera cifra es el premio mayor, §O.3), no un grado
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

  return (
    <section aria-labelledby={eyebrowId} className={cn('border-t border-text', className)}>
      {/* Eyebrow único. La LLAMADA ya NO vive aquí: cierra el micro-aviso de abajo (§22.4a,
          corrección de QA) — es lo que convierte el aviso en «hay más abajo».

          NINGUNA FECHA (PROJECT.md decisión 62, criterio 119). Aquí se pintaba «ESTIMADO · {date}»
          con la captura MÁS ANTIGUA de las cifras del bloque. Se retira, y no se suaviza a
          «actualizado» ni a un tooltip: esa fecha es **cuándo bajamos el dato**, no cuándo ocurrió
          la venta que lo respalda, y el rótulo no lo decía — un comprador podía leerla como fecha de
          venta. La fecha honesta (`evidenceDate`) **no se persiste**, así que no existe al leer y la
          de captura puede ir hasta 30 días adelantada. Se le ofreció al dueño rotularla con
          honestidad y eligió quitarla. Esto **no toca la frescura interna**: los dos relojes del
          criterio 118 se siguen evaluando server-side con la fecha de captura — se retira lo que se
          MUESTRA, no lo que se MIDE. Tampoco toca la fecha del valor de mercado (`marketValue.note`),
          que es otro dato y otra fila (criterio 119e). */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-4">
        <h2 id={eyebrowId} className="eyebrow">
          {t('eyebrow')}
        </h2>
      </div>

      {/* Misma CELDA de la ficha (`Fact`), retícula PROPIA: §22.3 prohíbe reutilizar `FactGrid`
          —el contenedor de los hechos de PRECIO, con su regla `border-border` y su `mt`— porque
          emparentaría dos retículas que deben leerse como categorías distintas (R2). Lo que sí se
          copia es su lógica NORMATIVA de divisor (§21.8b-2): **el divisor es de la POSICIÓN, no del
          hecho** — lo lleva la celda que no abre fila, nunca «la celda de PSA 9» hardcodeada.
          §22.7: con UNA sola cifra la retícula COLAPSA a una columna a ancho completo — nada de
          media retícula vacía ni de un `sm:border-l` huérfano. En móvil las celdas apilan solas. */}
      <div
        className={cn('grid', items.length > 1 && 'sm:grid-cols-2')}
        // Asociación redundante para que la ayuda técnica pueda leer el aviso completo desde la
        // cifra, sin navegar (§22.9).
        aria-describedby={anchors.noteId}
      >
        {items.map((e, i) => (
          <Fact
            key={e.gradeKey || `${e.gradingCompany}:${e.gradeValue}`}
            // Divisor POSICIONAL: solo en la celda que no abre fila de la retícula de 2 columnas
            // (§21.8b-2). Con `i > 0` una tercera cifra —si el dial `grades` creciera— heredaría un
            // divisor abriendo fila, que es exactamente el bug que esa norma cerró.
            className={cn(i % 2 !== 0 && 'sm:border-l sm:pl-7')}
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
                // La primera cifra es el premio mayor (§O.3): un escalón DENTRO de la misma
                // categoría, no un salto de voz. El resto comparte el tamaño menor.
                i === 0 ? 'text-[20px] sm:text-[22px]' : 'text-[16px] sm:text-[17px]',
              )}
            >
              {formatMoneyCents(e.estimate.referenceMxnCents!, locale)}
            </span>
          </Fact>
        ))}
      </div>

      {/* MICRO-AVISO (R3.1, §22.4c) — sustituye al viejo «renglón de procedencia», que cargaba la
          idea 2 pero NO la idea 1 y por eso no cumplía §O.5. Aquí cabe la versión corta completa:
          de dónde sale la cifra (inciso), que es ILUSTRATIVA y que NO evaluamos esta carta. */}
      <GradingMicroNotice
        namespace="catalog.gradingEstimate"
        className="mt-3 max-w-[560px] text-[12px] leading-[1.6]"
      />
    </section>
  );
}
