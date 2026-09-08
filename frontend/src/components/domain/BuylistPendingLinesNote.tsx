'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/**
 * **Por qué el total no es lo que el vendedor esperaba** (DESIGN_SYSTEM §23.3h, v2.3.8).
 *
 * > La evidencia que produjo esta regla: un **test E2E** agregó cartas de un set sin precios, vio
 * > el total en cero y **concluyó que el cotizador no sumaba**. No sumaba *porque no debía* — pero
 * > **nada en pantalla lo decía**. Si alguien que conoce el sistema saca esa conclusión, un
 * > vendedor con 999 cartas la saca seguro; y el vendedor no abre un issue: cierra la pestaña.
 *
 * Es **R7 aplicada al total**: si un conteo ausente no es un número, **un total de cero que
 * significa «todavía no lo he calculado» no es un cero**. Por línea ya estaba bien (`SIN PRECIO`,
 * nunca `MX$ 0.00`); lo que faltaba era decirlo **del agregado**, que es lo único que se mira
 * cuando hay cientos de líneas.
 *
 * **Tres decisiones de forma, las tres normativas:**
 * - **UNA sola vez, en el bloque de dinero, con el CONTEO interpolado.** ⛔ Nunca una línea por
 *   ítem: repetir la misma explicación N veces **es ruido, no información**, y hunde lo único que
 *   hay que leer. *La etiqueta se repite por línea; la explicación, no.*
 * - **Tinta `text-sm`, no `muted`** (§10 / §23.11 regla 1): explica por qué el total no es el que
 *   se esperaba, y eso no es letra al pie.
 * - **No lleva ningún monto** ⇒ §23.3c sigue intacta: el bloque de dinero tiene **exactamente un
 *   monto**. Un conteo de cartas **no es un monto**.
 *
 * **Y la segunda frase no es relleno: es la que evita que el vendedor las borre.** Sin ella,
 * «no suman» se lee como «no las queremos», y la reacción racional es **quitarlas del carrito** —
 * perdiendo justo las cartas que más trabajo nos costó catalogar. Dice **qué va a pasar con
 * ellas**, que es la doctrina de §23.3d movimiento 4: *cuando no hay número, se dice qué va a
 * pasar con el número*.
 */
export function BuylistPendingLinesNote({
  count,
  className,
}: {
  /** Cuántas CARTAS (no líneas) están sin precio. No se pinta con 0. */
  count: number;
  className?: string;
}) {
  const t = useTranslations('buylist');
  if (count <= 0) return null;
  return (
    <p
      data-testid="buylist-pending-note"
      className={cn('text-sm leading-[1.7] text-text', className)}
    >
      {t('quote.pendingLine.note', { count })}
    </p>
  );
}

/**
 * La **versalita** de una línea sin precio (§23.3h): `SIN PRECIO` en `accent`, **sin monto**.
 * ⛔ **Nunca `MX$ 0.00`** —cero es un precio y aquí no hay precio— y **nunca excluida en
 * silencio**: la línea se sigue viendo, solo que sin cifra.
 *
 * Sustituye al rótulo largo «Precio pendiente» (`buylist.linePending`) en las superficies del
 * **cotizador**. Fuera del cotizador —«Mis solicitudes»— sigue vivo el rótulo anterior: ahí la
 * línea ya no es una cotización viva, es el registro de una solicitud enviada.
 */
export function BuylistPendingLineLabel({ className }: { className?: string }) {
  const t = useTranslations('buylist');
  return (
    <span
      data-testid="buylist-pending-label"
      className={cn(
        'font-mono text-[11px] uppercase leading-none tracking-[0.06em] text-accent',
        className,
      )}
    >
      {t('quote.pendingLine.label')}
    </span>
  );
}
