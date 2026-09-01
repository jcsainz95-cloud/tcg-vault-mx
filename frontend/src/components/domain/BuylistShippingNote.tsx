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
 *
 * **⚠ `surface` — quién la está montando, y no es cosmético (§23.14.7-7, v2.3.8).**
 * El diseño manda **varios montajes** de esta misma nota (teaser del home ×2 por breakpoint,
 * cabecera de `/buylist`, bloque de dinero del carrito, paso de crear) y todos comparten
 * `data-testid`. Mientras no se distingan, **cualquier comprobación tiene que adivinar cuál
 * mira** — y eso ya produjo un diagnóstico falso: una prueba cogió `.first()`, dio con la copia
 * de escritorio (oculta a 390px **por diseño**) y se documentó como defecto de pantalla un
 * defecto de medición. `data-note-surface` no cambia un píxel: hace **nombrable** cada instancia.
 * **§23.3g-bis decide CUÁNTAS se ven (exactamente una); `surface` decide CUÁL se está mirando.**
 */
export function BuylistShippingNote({
  className,
  surface,
}: {
  className?: string;
  /** Identifica el montaje: `home-hero`, `home-mobile`, `buylist-header`, `cart-money`, … */
  surface?: string;
}) {
  const t = useTranslations('buylist');
  return (
    <p
      data-testid="buylist-shipping-note"
      data-note-surface={surface}
      className={cn('text-sm leading-[1.7] text-text', className)}
    >
      {t('quote.shippingNote')}
    </p>
  );
}
