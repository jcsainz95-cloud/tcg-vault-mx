'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { GroupedListingDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import { badgeEstimatesOf } from './estimates';
import { GradingMicroNotice } from './GradingMicroNotice';
import { useGradingFootnote } from './GradingFootnote';

/**
 * `GradingEstimateBadge` — badge de la TEJA de Compra y de la vitrina del home (§21.5, CORREGIDO
 * tras el bloqueante de QA). **Dos renglones lógicos, no tres**, separados del precio real por una
 * regla de 1px («lo de abajo es otra cosa»). Sin caja, sin icono, sin flecha, sin fecha.
 *
 *  - **El eyebrow `ESTIMADO SI SE GRADEA` desaparece** y su condicional se **incorpora a la propia
 *    cifra**: «En PSA 10 vale ≈ MX$ 29,000.00» (`sm+`) / «PSA 10 ≈ MX$ 29,000.00» (móvil). La
 *    palabra «ESTIMADO» del eyebrow y la palabra «Ilustrativo» del micro-aviso eran la MISMA idea,
 *    así que lo que sobra es el eyebrow — y eso es lo que hace que el aviso quepa (§21.5).
 *    Sigue **prohibido** «PSA 10: MX$ 29,000.00»: la condicionalidad la cargan «En…», el `≈` y el
 *    micro-aviso inmediato.
 *  - **Micro-aviso VISIBLE (R3.1)**: `<p>` de texto real —nunca `sr-only`, `title` ni tooltip— con
 *    las dos ideas obligatorias de §N.5 y la llamada `*` al cierre. Si no cabe, lo que se quita es
 *    **la cifra**, no el aviso (R3.4); por eso no lleva `truncate` ni `line-clamp`.
 *  - Presencia ⇔ elegibilidad: el gate de ROI es server-side. Sin `gradingHighlight` la teja se ve
 *    **exactamente como hoy** — sin badge vacío, tachado, en gris ni espacio reservado (R4).
 *  - La llamada NO es enlace aquí: la teja entera ya es un enlace y no se anidan anclas (§21.4a).
 *  - Se **itera** el arreglo: hoy el dial `highlightGrades` es `["10"]`, pero añadir PSA 9 al badge
 *    es editar el dial del servidor — este componente no cambia.
 */
export function GradingEstimateBadge({
  listing,
  className,
}: {
  listing: GroupedListingDTO;
  className?: string;
}) {
  const t = useTranslations('catalog.gradingBadge');
  const locale = useLocale() as AppLocale;
  const anchors = useGradingFootnote();

  const items = badgeEstimatesOf(listing);
  // R3.(3) + R4: sin nota al pie en esta página, o sin cifra, no se renderiza NADA.
  if (!anchors || !items) return null;

  // §21.9: el glifo `≈` va aria-hidden y su lectura viaja en prosa.
  const approx = (chunks: React.ReactNode) => (
    <>
      <span aria-hidden>{chunks}</span>
      <span className="sr-only">{t('approx')}</span>
    </>
  );

  return (
    <div className={cn('mt-2.5 border-t border-border pt-2.5', className)}>
      {items.map((e) => {
        const vars = {
          company: e.gradingCompany,
          grade: e.gradeValue,
          amount: formatMoneyCents(e.estimate.referenceMxnCents!, locale),
          approx,
        };
        return (
          <p
            key={e.gradeKey || `${e.gradingCompany}:${e.gradeValue}`}
            className="tabular whitespace-nowrap font-mono text-[11px] leading-[1.3] text-text sm:text-[12px]"
          >
            {/* Solo UNO de los dos se renderiza a la vez (display:none no llega al lector de
                pantalla), así que no hay texto duplicado en el árbol de accesibilidad. */}
            <span className="hidden sm:inline">{t.rich('figure', vars)}</span>
            <span className="sm:hidden">{t.rich('figureShort', vars)}</span>
          </p>
        );
      })}

      {/* MICRO-AVISO (R3.1) — ultra-corto, sans 11px, con la llamada `*` al final. Una sola vez por
          teja: cubre todas las cifras del badge (§21.4a: «una llamada por superficie»). */}
      <GradingMicroNotice
        namespace="catalog.gradingBadge"
        className="mt-1.5 text-[11px] leading-[1.4]"
      />
    </div>
  );
}
