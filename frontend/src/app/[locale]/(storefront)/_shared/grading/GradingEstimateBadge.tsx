'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { GroupedListingSummaryDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import { badgeEstimatesOf } from './estimates';
import { GradingMicroNotice } from './GradingMicroNotice';
import { useGradingFootnote } from './GradingFootnote';

/**
 * Las TRES superficies de rejilla que comparten este badge (§22.5, tabla del prop `surface`). Es un
 * enumerado **cerrado** a propósito: un `surface: string` libre —o un `figureForm` que aceptara
 * cualquier cosa— reabriría por la puerta de atrás la variante «ligera» sin aviso que R3 prohíbe.
 */
export type GradingBadgeSurface = 'grid' | 'featuredLead' | 'featuredRest';

/**
 * Lo ÚNICO que el prop decide (§22.5). Cada superficie tiene un ancho de teja distinto y **el
 * breakpoint del viewport no lo predice** en el carrusel (la teja chica mide 160px aunque el
 * viewport ya sea `sm`), así que el corte entre la forma larga y la corta se declara aquí.
 *
 * Lo que este mapa NO puede tocar, y es normativo: el micro-aviso (ni su presencia, ni su copy, ni
 * su familia, ni su tamaño), la regla superior, la llamada `*` y el piso de 11px (§22.4d).
 */
const SURFACE_SPEC: Record<
  GradingBadgeSurface,
  {
    /** Clases del envoltorio de la forma LARGA (`figure`); `null` ⇒ **nunca** se pinta. */
    long: string | null;
    /** Clases del envoltorio de la forma CORTA (`figureShort`); `''` ⇒ siempre visible. */
    short: string;
    /** Tamaño de la cifra: 11px, 12px a partir del breakpoint de la superficie. */
    size: string;
  }
> = {
  // Teja de Compra (§22.5) y vitrina (§22.6): el ancho SÍ sigue al viewport. Sin cambio alguno.
  grid: { long: 'hidden sm:inline', short: 'sm:hidden', size: 'text-[11px] sm:text-[12px]' },
  // Teja GRANDE del carrusel (§22.6b-a): 236px hasta `lg`, 400px desde `lg`. El corte es `lg`.
  featuredLead: { long: 'hidden lg:inline', short: 'lg:hidden', size: 'text-[11px] lg:text-[12px]' },
  // Tejas CHICAS del carrusel (§22.6b-b): 268px en su mejor momento y la forma larga en EN pide
  // ~274px ⇒ `figureShort` SIEMPRE. Una cifra que desborda es peor que una forma corta.
  featuredRest: { long: null, short: '', size: 'text-[11px] lg:text-[12px]' },
};

/**
 * `GradingEstimateBadge` — badge de la TEJA de Compra y de la vitrina del home (§22.5, CORREGIDO
 * tras el bloqueante de QA). **Dos renglones lógicos, no tres**, separados del precio real por una
 * regla de 1px («lo de abajo es otra cosa»). Sin caja, sin icono, sin flecha, sin fecha.
 *
 *  - **El eyebrow `ESTIMADO SI SE GRADEA` desaparece** y su condicional se **incorpora a la propia
 *    cifra**: «En PSA 10 vale ≈ MX$ 29,000.00» (`sm+`) / «PSA 10 ≈ MX$ 29,000.00» (móvil). La
 *    palabra «ESTIMADO» del eyebrow y la palabra «Ilustrativo» del micro-aviso eran la MISMA idea,
 *    así que lo que sobra es el eyebrow — y eso es lo que hace que el aviso quepa (§22.5).
 *    Sigue **prohibido** «PSA 10: MX$ 29,000.00»: la condicionalidad la cargan «En…», el `≈` y el
 *    micro-aviso inmediato.
 *  - **Micro-aviso VISIBLE (R3.1)**: `<p>` de texto real —nunca `sr-only`, `title` ni tooltip— con
 *    las dos ideas obligatorias de §O.5 y la llamada `*` al cierre. Si no cabe, lo que se quita es
 *    **la cifra**, no el aviso (R3.4); por eso no lleva `truncate` ni `line-clamp`.
 *  - Presencia ⇔ elegibilidad: el gate de ROI y el de confianza (R6) son server-side y llegan
 *    resueltos en `GroupedListingSummaryDTO.gradingHighlight` (v1.50.2, el DTO de la REJILLA: la
 *    teja de Compra y la de la vitrina son la misma). Sin `gradingHighlight` la teja se ve
 *    **exactamente como hoy** — sin badge vacío, tachado, en gris ni espacio reservado (R4).
 *  - La llamada NO es enlace aquí: la teja entera ya es un enlace y no se anidan anclas (§22.4a).
 *  - Se **itera** el arreglo: hoy el dial `highlightGrades` es `["10"]`, pero añadir PSA 9 al badge
 *    es editar el dial del servidor — este componente no cambia.
 *  - **`surface` es el ÚNICO eje configurable** (§22.5, añadido por §22.6b): elige cuál de las DOS
 *    formas de copy YA RATIFICADAS se pinta y a partir de qué breakpoint. Nada más. Ver
 *    `SURFACE_SPEC`.
 */
export function GradingEstimateBadge({
  listing,
  surface = 'grid',
  className,
}: {
  listing: GroupedListingSummaryDTO;
  /** §22.5: enumerado CERRADO. Un cuarto valor es una decisión de diseño, no de implementación. */
  surface?: GradingBadgeSurface;
  className?: string;
}) {
  const t = useTranslations('catalog.gradingBadge');
  const locale = useLocale() as AppLocale;
  const anchors = useGradingFootnote();
  const spec = SURFACE_SPEC[surface];

  const items = badgeEstimatesOf(listing);
  // R3.(3) + R4: sin nota al pie en esta página, o sin cifra, no se renderiza NADA.
  if (!anchors || !items) return null;

  // §22.9: el glifo `≈` va aria-hidden y su lectura viaja en prosa.
  const approx = (chunks: React.ReactNode) => (
    <>
      <span aria-hidden>{chunks}</span>
      <span className="sr-only">{t('approx')}</span>
    </>
  );

  // El `nowrap` va en el MONTO, no en el párrafo (§22.6b). Con la clase en el `<p>` entero, un
  // importe grande en una teja estrecha desbordaba la teja EN SILENCIO —no hay caja que lo delate—
  // en vez de envolver la prosa que sí puede envolver. Aquí lo indivisible es la cifra y nada más.
  const nb = (chunks: React.ReactNode) => <span className="whitespace-nowrap">{chunks}</span>;

  return (
    <div className={cn('mt-2.5 border-t border-border pt-2.5', className)}>
      {items.map((e) => {
        const vars = {
          company: e.gradingCompany,
          grade: e.gradeValue,
          amount: formatMoneyCents(e.estimate.referenceMxnCents!, locale),
          approx,
          nb,
        };
        return (
          <p
            key={e.gradeKey || `${e.gradingCompany}:${e.gradeValue}`}
            className={cn('tabular font-mono leading-[1.3] text-text', spec.size)}
          >
            {/* Solo UNO de los dos se renderiza a la vez (display:none no llega al lector de
                pantalla), así que no hay texto duplicado en el árbol de accesibilidad. */}
            {spec.long !== null && <span className={spec.long}>{t.rich('figure', vars)}</span>}
            <span className={spec.short || undefined}>{t.rich('figureShort', vars)}</span>
          </p>
        );
      })}

      {/* MICRO-AVISO (R3.1) — ultra-corto, sans 11px, con la llamada `*` al final. Una sola vez por
          teja: cubre todas las cifras del badge (§22.4a: «una llamada por superficie»). */}
      <GradingMicroNotice
        namespace="catalog.gradingBadge"
        className="mt-1.5 text-[11px] leading-[1.4]"
      />
    </div>
  );
}
