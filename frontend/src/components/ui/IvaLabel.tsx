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
  /**
   * §MIV.10 (vMIV-2) — `false` ⇒ variante SIN tasa: «incluye IVA» / «VAT included»
   * (`common.ivaIncludedBare`), para las superficies de **mercado** (celda de valor de mercado de las
   * fichas y rótulo de la tendencia). Por defecto `true` ⇒ «IVA {rate} % incluido», que es el rótulo del
   * **precio** y ⛔ NO cambia. `showRate` SOLO afecta la rama inclusiva (`ivaIncluded === true`); las
   * ramas «sin IVA» y «no pinta nada» son el corazón de §M10-IVA y NO dependen de esta prop.
   */
  showRate?: boolean;
  className?: string;
  /**
   * §MIV.5 (vMIV-1) — para que un contenedor lo nombre con `aria-labelledby` junto a su cifra
   * («Valor de mercado MX$1,160.00 IVA 16 % incluido»). Ensanchamiento compatible.
   */
  id?: string;
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
export function IvaLabel({ ivaIncluded, ivaRatePct, showRate = true, className, id }: IvaLabelProps) {
  const t = useTranslations('common');
  if (ivaIncluded === undefined) return null;
  // §MIV.10 (vMIV-2): la rama inclusiva pinta la TASA por defecto (precio) o la variante sin tasa
  // («incluye IVA») cuando `showRate === false` (mercado). La rama «sin IVA» es invariable (criterio 190).
  const inclusive = showRate ? t('ivaIncluded', { rate: ivaRatePct ?? 0 }) : t('ivaIncludedBare');
  return (
    <span
      id={id}
      data-testid="iva-label"
      data-iva-included={ivaIncluded ? 'true' : 'false'}
      className={cn('font-mono text-[11px] leading-relaxed text-muted', className)}
    >
      {ivaIncluded ? inclusive : t('withoutIva')}
    </span>
  );
}
