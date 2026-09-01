'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getOrder } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { CardImage } from '@/components/ui/CardImage';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { historicalCardMeta, historicalCardName } from '@/lib/historical-card';

/**
 * 6f (detalle) — Repite el desglose del pago y deja la factura como acción
 * secundaria al pie de la columna de importes. Los artículos son renglones con
 * regla, no tarjetas.
 */
export function OrderDetailView({ orderId }: { orderId: string }) {
  const t = useTranslations('orders');
  const tc = useTranslations('checkout');
  const locale = useLocale() as AppLocale;
  const [requested, setRequested] = useState(false);
  const query = useQuery({ queryKey: ['order', orderId], queryFn: () => getOrder(orderId) });

  return (
    <QueryState
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      {query.data && (
        <div>
          <div className="gutter flex flex-wrap items-baseline justify-between gap-4 pb-5 pt-10 lg:pt-[46px]">
            <h1 className="font-serif text-[22px] leading-[1.15] text-text lg:text-[30px]">
              {t('orderNumber', { id: query.data.id })}
            </h1>
            <span className="flex items-center gap-2 font-mono text-[11px] text-muted">
              <StatusBadge domain="order" value={query.data.status} />
              <span aria-hidden>·</span>
              {formatDate(query.data.createdAt, locale)}
            </span>
          </div>

          <div className="grid border-t border-border lg:grid-cols-[1fr_400px]">
            <div className="gutter border-b border-border pb-12 pt-6 lg:border-b-0 lg:border-r">
              <h2 className="eyebrow">{t('items')}</h2>
              <div className="mt-2.5">
                {query.data.items.map((it) => {
                  /*
                   * RENDER DEGRADADO POR CAMPO (contrato §4 «Tolerancia del histórico» punto 4;
                   * ARCHITECTURE §5.2.9). Ésta es la ÚNICA superficie que lee del histórico: su
                   * `card` es `HistoricalOrderItemCardDTO` y CUALQUIER hecho puede faltar.
                   * Interpolarlos a pelo pintaba la línea MUDA —`{it.card.name}` con `name`
                   * ausente rinde cadena vacía, y el `alt` de la miniatura salía `null`—: el
                   * importe estaba bien y aun así la línea no decía nada.
                   * ⛔ El hueco NO se rellena con `GET /catalog/cards/:cardId` ni con ninguna
                   * otra consulta: sería re-resolver un hecho congelado desde el cliente
                   * (§5.2.2). El acta dice lo que registró; si no lo registró, lo dice también.
                   */
                  const { text: itemName, hasName } = historicalCardName(it.card, t('item.unknownCard'));
                  const meta = historicalCardMeta(it.card);
                  return (
                    <div
                      key={it.inventoryItemId}
                      className="flex items-center gap-[18px] border-b border-border py-4 last:border-b-0"
                    >
                      <div className="w-11 shrink-0">
                        {/* `alt` SIEMPRE con texto (WCAG 1.1.1): el nombre real o la etiqueta
                            neutra. Sin `cardId` la imagen es `null` por construcción y aquí
                            queda el pozo de papel quieto, que es el placeholder del contrato. */}
                        <CardImage src={it.card.imageSmallUrl} alt={itemName} className="p-1" />
                      </div>
                      <div className="min-w-0 flex-1">
                        {hasName ? (
                          // datos de catálogo en inglés → lang="en" (DESIGN_SYSTEM §9.2)
                          <span className="text-[15px] text-text" lang="en">
                            {itemName}
                          </span>
                        ) : (
                          /* Etiqueta neutra: mono en versalitas muted, el mismo tratamiento que
                             el resto de etiquetas honestas del sistema (§7.3). Debe leerse
                             DELIBERADA —«esto no consta»— y no como un fallo de carga. NO lleva
                             `lang="en"`: es copy de la interfaz, no un nombre de catálogo. */
                          <span
                            title={t('item.unknownCardHint')}
                            className="font-mono text-[11px] uppercase leading-none tracking-[0.08em] text-muted"
                          >
                            {itemName}
                          </span>
                        )}
                        {/* Fragmentos que el acta no registró: se OMITEN. Sin renglón vacío. */}
                        {meta && (
                          <p lang="en" className="mt-1.5 font-mono text-[11px] text-muted">
                            {meta}
                          </p>
                        )}
                      </div>
                      {/* El dinero NO vive en el blob (`unitPriceCents` es columna propia de
                          `OrderItem`): un snapshot incompleto no mueve un centavo. */}
                      <span className="tabular shrink-0 text-[15px] text-text">
                        {formatMoneyCents(it.unitPriceCents, locale)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <aside className="gutter h-fit pb-12 pt-6 lg:px-10">
              <AmountBreakdown breakdown={query.data.breakdown} variant="purchase" />

              <div className="mt-7 flex items-center justify-between border-t border-border pt-4 text-[13px] text-muted">
                <span>{t('cfdiStatusLabel')}</span>
                <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-text">
                  {query.data.cfdiStatus}
                </span>
              </div>

              {requested || query.data.invoiceRequested ? (
                <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted">{tc('cfdiNotice')}</p>
              ) : (
                <>
                  <Button variant="secondary" className="mt-4 w-full" onClick={() => setRequested(true)}>
                    {t('requestInvoice')}
                  </Button>
                  <p className="mt-3.5 font-mono text-[11px] leading-relaxed text-muted">{tc('cfdiNotice')}</p>
                </>
              )}
            </aside>
          </div>
        </div>
      )}
    </QueryState>
  );
}
