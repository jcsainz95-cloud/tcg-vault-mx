'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { GroupedListingDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import { badgeEstimatesOf } from './estimates';
import { GradingNoteCall, useGradingFootnote } from './GradingFootnote';

/**
 * `GradingEstimateBadge` — badge de la TEJA de Compra y de la vitrina del home (§21.5). Dos
 * renglones: eyebrow + cifra, separados del precio real por una regla de 1px («lo de abajo es otra
 * cosa»). Sin caja, sin icono, sin flecha, sin fecha.
 *
 *  - La palabra **«ESTIMADO» del eyebrow es obligatoria** y NO se abrevia ni se trunca: es lo que
 *    impide que la cifra se lea como una afirmación. Si no cabe, **envuelve a dos renglones**.
 *  - La cifra va **siempre con el condicional delante**: se lee «estimado si se gradea, PSA 10 ≈
 *    MX$ 2,900.00», nunca «PSA 10: MX$ 2,900.00».
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

  return (
    <div className={cn('mt-2.5 border-t border-border pt-2.5', className)}>
      <p className="eyebrow leading-[1.4]">
        {t('eyebrow')}
        <GradingNoteCall />
      </p>
      {items.map((e) => (
        <p
          key={e.gradeKey || `${e.gradingCompany}:${e.gradeValue}`}
          className="tabular mt-1 whitespace-nowrap font-mono text-[11px] leading-none text-text sm:text-[12px]"
        >
          {t.rich('figure', {
            company: e.gradingCompany,
            grade: e.gradeValue,
            amount: formatMoneyCents(e.estimate.referenceMxnCents!, locale),
            // §21.9: el glifo `≈` va aria-hidden y su lectura viaja en prosa.
            approx: (chunks) => (
              <>
                <span aria-hidden>{chunks}</span>
                <span className="sr-only">{t('approx')}</span>
              </>
            ),
          })}
        </p>
      ))}
    </div>
  );
}
