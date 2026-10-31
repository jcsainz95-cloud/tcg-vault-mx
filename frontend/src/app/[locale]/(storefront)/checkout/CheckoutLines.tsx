'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { OrderItemPreview } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { CardImage } from '@/components/ui/CardImage';
import { historicalCardMeta } from '@/lib/historical-card';

/** CHK-MOVIL.2.5: las líneas muestran 2 y «Ver {n} más» pliega el resto. */
export const VISIBLE_LINES = 2;

export interface CheckoutLinesProps {
  items: OrderItemPreview[];
  onRemove: (inventoryItemId: string) => void;
}

/**
 * Renglones del carrito (artboard «Carrito y pago»), comunes a invitado y cuenta: miniatura, nombre en serif
 * (`truncate` dentro de un padre `min-w-0`, CHK-MOVIL.1), meta en mono, «Quitar» con área de 44 px y el precio
 * tabular a la derecha. v1.51-b: `productType`/`rawCondition` viajan DENTRO de `card` (`OrderItemCardDTO`).
 * MENOR-3: la meta es la MISMA regla que la del pedido (`historicalCardMeta`): set · #número · NM (raw) o
 * · empresa grado (graded, p. ej. «PSA 10»), omitiendo los fragmentos que no vengan.
 */
export function CheckoutLines({ items, onRemove }: CheckoutLinesProps) {
  const t = useTranslations('checkout');
  const locale = useLocale() as AppLocale;
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, VISIBLE_LINES);
  const hidden = items.length - shown.length;

  return (
    <div>
      <ul className="pt-2">
        {shown.map((item) => (
          <li key={item.inventoryItemId} className="flex min-w-0 items-start gap-4 border-b border-border py-5 sm:gap-5">
            <div className="w-16 shrink-0 sm:w-[92px]">
              <CardImage src={item.card.imageSmallUrl} alt={item.card.name} className="p-1" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-serif text-[17px] leading-tight text-text sm:text-[19px]" lang="en">
                {item.card.name}
              </p>
              <p className="mt-1.5 font-mono text-[11px] text-muted [overflow-wrap:anywhere]" lang="en">
                {historicalCardMeta(item.card)}
              </p>
              <button
                type="button"
                aria-label={t('removeItem')}
                onClick={() => onRemove(item.inventoryItemId)}
                className="mt-1 inline-flex min-h-[44px] items-center font-mono text-[11px] text-muted hover:text-accent"
              >
                {t('removeItem')}
              </button>
            </div>
            <span className="tabular shrink-0 text-right text-[17px] font-medium text-text sm:text-[19px]">
              {/* §DSC I-3: con código, `unitPriceCents` es lo COBRADO; el exhibido lo da el servidor (`unitPriceBeforeDiscountCents`,
                  v1.110.3) y la línea lo pinta para cuadrar con «Subtotal» (S) y la fila «Descuento». ⛔ Sin sumar (DCO-F6). */}
              {formatMoneyCents(item.unitPriceBeforeDiscountCents ?? item.unitPriceCents, locale)}
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex min-h-[44px] items-center text-sm text-text underline underline-offset-4 hover:text-accent"
        >
          {t('showMoreLines', { n: hidden })}
        </button>
      )}
    </div>
  );
}
