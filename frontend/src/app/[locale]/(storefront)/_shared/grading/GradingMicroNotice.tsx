'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { GradingNoteCall, useGradingFootnote } from './GradingFootnote';

/**
 * **El micro-aviso adyacente** (DESIGN_SYSTEM §21.4c, R3.1) — el aviso que va **junto a la cifra**,
 * VISIBLE para un comprador vidente, con las **dos ideas obligatorias** de PROJECT §N.5:
 * **«ilustrativo»** + **«no evaluamos esta carta»**. Cierra con la **llamada `*`** a la nota al pie.
 *
 * **Por qué existe este componente (bloqueante de QA).** La versión anterior dejaba el aviso en
 * `sr-only` apoyándose en la nota al pie: invisible para quien ve la pantalla, y §N.5 lo califica de
 * **defecto bloqueante**. Centralizarlo hace que las tres superficies no puedan divergir y que
 * **aviso y llamada sean inseparables**: no hay forma de pintar uno sin el otro.
 *
 * Reglas que este componente encarna y que NO son configurables (§21.10 nº13):
 *  - **Texto real, nunca `sr-only` / `title` / tooltip.** Lo que se ve es lo que se lee.
 *  - **Sans, no mono** (§21.4c): es prosa abreviada, no una etiqueta ni un dato — y la sans es ~20%
 *    más estrecha, que es justo lo que la hace caber en una teja.
 *  - **Las dos ideas en tinta 500** dentro del párrafo muted (rich text `<b>`, jamás dos claves).
 *  - **Nunca se trunca, nunca lleva ellipsis, nunca colapsa a una sola idea**: por eso aquí no hay
 *    `truncate`, `line-clamp` ni variante «corta» que se pueda apagar por breakpoint o por prop.
 *  - **Piso tipográfico propio** (§21.4d): 11px en la teja, 12px en la ficha. No baja de ahí ni a
 *    390px. Si hubiera que elegir entre encoger el aviso y quitar la cifra, **se quita la cifra**.
 *  - Fuera de una boundary de nota al pie devuelve `null` — el mismo fail-closed que la cifra, así
 *    que jamás queda un aviso huérfano ni, peor, una cifra sin aviso.
 */
export function GradingMicroNotice({
  namespace,
  className,
}: {
  /** `catalog.gradingBadge` = ultra-corto (teja y vitrina) · `catalog.gradingEstimate` = corto (ficha). */
  namespace: 'catalog.gradingBadge' | 'catalog.gradingEstimate';
  className?: string;
}) {
  // Ambos hooks se llaman SIEMPRE (regla de hooks); solo se elige de cuál se lee.
  const tBadge = useTranslations('catalog.gradingBadge');
  const tBlock = useTranslations('catalog.gradingEstimate');
  const anchors = useGradingFootnote();
  if (!anchors) return null;

  const isBadge = namespace === 'catalog.gradingBadge';
  const text = isBadge ? tBadge.rich('microNotice', RICH) : tBlock.rich('microNotice', RICH);

  return (
    <p className={cn('text-muted', className)}>
      {text}
      {/* La llamada cierra el aviso (§21.4a): es lo que convierte el aviso abreviado en «hay más
          abajo». En la ficha es un enlace real; en la teja no, porque la teja entera ya es uno. */}
      <GradingNoteCall variant={isBadge ? 'plain' : 'link'} />
    </p>
  );
}

/** Las dos ideas obligatorias en tinta 500 dentro del párrafo muted (§21.4c). */
const RICH = {
  b: (chunks: React.ReactNode) => <strong className="font-medium text-text">{chunks}</strong>,
};
