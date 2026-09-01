'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/**
 * NOTA DE SERVICIO del envío en el cotizador (DESIGN_SYSTEM §23.3c/d · D43).
 *
 * **Es copy estático y nada más.** Un párrafo, una sola clave (`buylist.quote.shippingNote`),
 * SIN placeholders y SIN ninguna cifra: bajo D43 el cotizador dice el envío EN PALABRAS. La
 * tarifa se comunica con número donde es vinculante —el correo de oferta y `offer.terms`—, y
 * ni siquiera viaja en un DTO público, así que no hay nada que pintar aquí ni por accidente.
 *
 * **Consecuencias de forma, todas normativas (§23.3c):**
 * - **No depende de ningún dato** ⇒ no se esqueletiza, no espera al servidor, no aparece ni
 *   desaparece con el estado del carrito. Se pinta desde el primer render, incluso con el
 *   carrito vacío: el trato se explica cuando todavía no cuesta nada cambiar de opinión.
 * - **Tinta (`text-text`), `text-sm`** — nunca `muted`: es la ÚNICA cosa que el vendedor lee
 *   sobre el envío antes de la oferta, y degradarla de color la convertiría en letra chica.
 * - **Sin icono, sin caja, sin pozo y sin regla que la separe del monto**: un escalón de
 *   superficie la volvería «aviso», y un aviso sobre un trato que le conviene al vendedor lo
 *   enmarca como problema. Solo aire (§4.1, ~12px) la separa de la cifra.
 * - **No es región `aria-live`**: es texto permanente; repetirlo en cada cambio del carrito
 *   sería ruido para quien navega con lector de pantalla. Se lee una vez, en su orden del DOM.
 * - **No se trunca**: sin `line-clamp`, sin «ver más». Si no cupiera, se corrige el contenedor.
 */
export function BuylistShippingNote({ className }: { className?: string }) {
  const t = useTranslations('buylist');
  return (
    <p data-testid="buylist-shipping-note" className={cn('text-sm leading-[1.7] text-text', className)}>
      {t('quote.shippingNote')}
    </p>
  );
}
