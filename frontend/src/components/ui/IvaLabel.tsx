'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

export interface IvaLabelProps {
  /**
   * §M10-IVA.3 — **la convención de ESTA cifra**, tal como la emitió el servidor para esta fila.
   * `undefined` ⇒ **la pantalla no afirma nada** y no se pinta rótulo (ver abajo).
   */
  ivaIncluded?: boolean;
  /** §M10-IVA.3 — la **TASA** (16). ⛔ NO es el dial de traslación, que ⛔ no viaja a superficie de cliente (criterio **209**). */
  ivaRatePct?: number;
  className?: string;
}

/**
 * ⭐⭐ **EL ÚNICO SITIO QUE ROTULA LA CONVENCIÓN DE IVA DE UN PRECIO** (§M10-IVA.3/.4,
 * criterios **195** y **208**).
 *
 * **Por qué existe un componente para dos cadenas de texto**, que es la pregunta razonable:
 *
 * 1. **Criterios 195 y 208 se verifican POR AUSENCIA** — *«no aparece ninguna variante de
 *    "trasladado", "conforme a la ley", "no es un recargo", "por disposición fiscal" ni cita de
 *    norma alguna, tampoco en negativo»*. Un texto de impuesto disperso por nueve pantallas se
 *    audita nueve veces y se rompe en la décima. Aquí hay **un punto de estrangulamiento**, y su
 *    test de copy vale para todas las superficies que cuelgan de él.
 * 2. **El rótulo es DATO, no decoración** (criterio **190**). Se elige con `ivaIncluded`, que viaja
 *    **por fila**: la misma pantalla puede pintar una pieza nueva (`IVA_INCLUSIVE`) al lado del
 *    detalle de un pedido viejo (`IVA_EXCLUSIVE`), y ⛔ *un pedido ya cobrado no se reinterpreta
 *    solo*.
 *
 * ⛔⛔ **NO HAY DEFAULT, Y ES DELIBERADO.** Con `ivaIncluded === undefined` **no se pinta nada**.
 * Un default a `true` rotularía «IVA incluido» sobre cifras que no lo llevan —la mentira exacta que
 * §M10-IVA existe para evitar— y un default a `false` haría lo contrario en cuanto se encienda la
 * convención. *Un rótulo de impuesto adivinado es peor que ningún rótulo: se lee como un hecho.*
 *
 * ⛔ **El único rótulo admitido es de IMPORTE.** «IVA 16 % incluido» / «sin IVA». Cero afirmaciones
 * jurídicas, en ninguna dirección — **hoy no hay abogado en el proyecto** (`DESIGN_SYSTEM §7.12a`).
 *
 * ⚠️ **Petición a ux-ui, declarada aquí porque el hueco es suyo y no mío:** `DESIGN_SYSTEM` sigue
 * diciendo *«sin IVA»* como literal fijo en §7.3, §21.8 y §31; el rótulo inclusivo lo fija hoy
 * `PROJECT.md` criterio **195** y `API_CONTRACT §M10-IVA.4`. Se implementa por esos dos (regla de
 * conflicto: `PROJECT.md` manda sobre el contrato, y el contrato sobre el código) y queda anotado
 * en `docs/FRONTEND_NOTES.md`.
 */
export function IvaLabel({ ivaIncluded, ivaRatePct, className }: IvaLabelProps) {
  const t = useTranslations('common');
  if (ivaIncluded === undefined) return null;
  return (
    <span
      data-testid="iva-label"
      data-iva-included={ivaIncluded ? 'true' : 'false'}
      className={cn('font-mono text-[11px] leading-relaxed text-muted', className)}
    >
      {ivaIncluded ? t('ivaIncluded', { rate: ivaRatePct ?? 0 }) : t('withoutIva')}
    </span>
  );
}
