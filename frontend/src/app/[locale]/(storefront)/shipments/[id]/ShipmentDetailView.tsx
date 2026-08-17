'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getShipment } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import type { AddressDTO, BreakdownDTO, ShipmentDTO } from '@/types/contract';
import { formatDate } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { CardImage } from '@/components/ui/CardImage';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { QueryState } from '@/components/ui/QueryState';
import { FinishBadge } from '@/components/domain/FinishBadge';
import { useShipmentClientSteps } from '@/lib/pipelines';

/** Lee un campo string de un `addressSnapshot` de forma tolerante (forma abierta del contrato §5). */
function addrField(snapshot: ShipmentDTO['addressSnapshot'], key: keyof AddressDTO): string | undefined {
  if (!snapshot) return undefined;
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Construye un `BreakdownDTO` (para AmountBreakdown, variante envío) a partir de los montos del
 * retiro (contrato §5: `shippingFeeCents` = subtotal). `ivaRatePct` no viaja en el DTO de rastreo →
 * se deriva de iva/fee (default 16 si no se puede). Devuelve null si el retiro no trae montos (p. ej.
 * aún `solicitado` sin desglose).
 */
function shipmentBreakdown(s: ShipmentDTO): BreakdownDTO | null {
  if (s.totalCents == null) return null;
  const subtotalCents = s.shippingFeeCents ?? 0;
  const ivaCents = s.ivaCents ?? 0;
  const ivaRatePct = subtotalCents > 0 ? Math.round((ivaCents / subtotalCents) * 100) : 16;
  return {
    subtotalCents,
    ivaCents,
    ivaRatePct,
    processingFeeCents: s.processingFeeCents ?? 0,
    totalCents: s.totalCents,
    currency: 'MXN',
  };
}

/**
 * Detalle / rastreo de un retiro del cliente (contrato §5 · GET /shipments/:id, v1.17). Es el destino
 * del deep-link del badge "EN RETIRO" de la bóveda (`HoldingDTO.activeShipmentId`). Muestra la etapa
 * legible (tabla §5), la línea de tiempo, la dirección, el total desglosado, la guía/tracking y las
 * cartas incluidas (folio, nombre, set, acabado). Estados de carga/error/no-encontrado explícitos.
 */
export function ShipmentDetailView({ shipmentId }: { shipmentId: string }) {
  const t = useTranslations('shipments');
  const ts = useTranslations('shipmentStage');
  const locale = useLocale() as AppLocale;
  const steps = useShipmentClientSteps();
  const query = useQuery({
    queryKey: ['shipment', shipmentId],
    queryFn: () => getShipment(shipmentId),
  });

  return (
    <div>
      <div className="gutter pb-5 pt-10 lg:pt-[46px]">
        <Link href="/shipments" className="font-mono text-[11px] uppercase tracking-label text-muted hover:text-text">
          ← {t('backToList')}
        </Link>
      </div>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data && (
          <div>
            <div className="gutter flex flex-wrap items-baseline justify-between gap-4 border-t border-border pb-5 pt-6">
              <h1 className="font-serif text-[22px] leading-[1.15] text-text lg:text-[30px]">
                {t('detailTitle', { id: query.data.id })}
              </h1>
              <span className="flex items-center gap-2 font-mono text-[11px] text-muted">
                <StatusBadge domain="shipment" value={query.data.status} />
                {query.data.requestedAt && (
                  <>
                    <span aria-hidden>·</span>
                    {formatDate(query.data.requestedAt, locale)}
                  </>
                )}
              </span>
            </div>

            {/* Etapa legible (tabla §5) + línea de tiempo del rastreo. */}
            <div className="gutter border-t border-border pb-8 pt-6">
              <p className="font-serif text-[18px] leading-tight text-text">{ts(query.data.status)}</p>
              <div className="mt-5">
                <PipelineStepper
                  steps={steps}
                  current={query.data.status}
                  errored={query.data.status === 'cancelado'}
                />
              </div>
              {query.data.trackingNumber && (
                <p className="mt-5 font-mono text-[12px] text-muted">
                  {query.data.carrier} · {t('tracking')} {query.data.trackingNumber}
                </p>
              )}
            </div>

            <div className="grid border-t border-border lg:grid-cols-[1fr_360px]">
              {/* Cartas incluidas en el retiro. */}
              <div className="gutter border-b border-border pb-10 pt-6 lg:border-b-0 lg:border-r">
                <h2 className="eyebrow">{t('itemsInWithdrawal')}</h2>
                <div className="mt-3">
                  {query.data.items.map((it) => (
                    <div
                      key={it.inventoryItemId}
                      className="flex items-center gap-4 border-b border-border py-4 last:border-b-0"
                    >
                      <div className="w-11 shrink-0">
                        <CardImage src={it.card.imageSmallUrl} alt={it.card.name} className="p-1" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] text-text" lang="en">
                          {it.card.name}
                        </p>
                        <p className="mt-1 truncate font-mono text-[11px] text-muted" lang="en">
                          {it.card.setName} · {it.card.number}
                        </p>
                      </div>
                      {it.finish && <FinishBadge finish={it.finish} />}
                      <span className="tabular shrink-0 font-mono text-[11px] text-muted">{it.folio}</span>
                    </div>
                  ))}
                </div>
              </div>

              <aside className="gutter h-fit pb-10 pt-6 lg:px-8">
                {/* Dirección de envío (snapshot). */}
                <h2 className="eyebrow">{t('shippingAddress')}</h2>
                <address className="mt-3 not-italic text-[13px] leading-relaxed text-text">
                  {addrField(query.data.addressSnapshot, 'line1') ? (
                    <>
                      <div>{addrField(query.data.addressSnapshot, 'line1')}</div>
                      {addrField(query.data.addressSnapshot, 'line2') && (
                        <div>{addrField(query.data.addressSnapshot, 'line2')}</div>
                      )}
                      <div>
                        {[
                          addrField(query.data.addressSnapshot, 'neighborhood'),
                          addrField(query.data.addressSnapshot, 'city'),
                          addrField(query.data.addressSnapshot, 'state'),
                          addrField(query.data.addressSnapshot, 'postalCode'),
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </div>
                    </>
                  ) : (
                    <span className="text-muted">{t('addressUnavailable')}</span>
                  )}
                </address>

                {/* Total del retiro desglosado (si el DTO trae montos). */}
                {(() => {
                  const breakdown = shipmentBreakdown(query.data!);
                  return breakdown ? (
                    <div className="mt-8 border-t border-border pt-6">
                      <h2 className="eyebrow mb-2">{t('withdrawalTotal')}</h2>
                      <AmountBreakdown breakdown={breakdown} variant="shipment" />
                    </div>
                  ) : null;
                })()}
              </aside>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}
