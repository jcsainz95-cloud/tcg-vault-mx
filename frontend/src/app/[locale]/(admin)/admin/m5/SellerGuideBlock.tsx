'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { asApiError } from '@/lib/api-client';
import type { AdminBuylistDTO, AdminInboundShipmentDTO } from '@/types/contract';
import { Button } from '@/components/ui/Button';
import { openLabelPdf } from '../m4/capture/label-pdf';
import { CopyButton } from './BuylistFlowParts';
import { safeHttpUrl } from '@/lib/safe-href';

type GuideSource = Pick<AdminBuylistDTO, 'inboundShipment' | 'shipmentCarrier' | 'shipmentTrackingNumber'>;
export interface ManualGuide { carrier: string | null; trackingNumber: string }

/**
 * Qué guía mostrar. Hay guía de entrada cuando la fila trae `trackingNumber` o `labelSource` (una fila `cancelado`
 * vacía —guía a mano + fila abierta sin comprar + confirm-shipment— NO cuenta). Si no, la guía a mano vive en la
 * solicitud (`shipmentCarrier`/`shipmentTrackingNumber`; el backend nunca crea fila `manual`).
 */
export function sellerGuideOf(req: GuideSource): { inbound: AdminInboundShipmentDTO | null; manual: ManualGuide | null } | null {
  const i = req.inboundShipment ?? null;
  if (i && (i.trackingNumber || i.labelSource)) return { inbound: i, manual: null };
  if (req.shipmentTrackingNumber) return { inbound: null, manual: { carrier: req.shipmentCarrier ?? null, trackingNumber: req.shipmentTrackingNumber } };
  return null;
}

export function hasSellerGuide(req: GuideSource): boolean {
  return sellerGuideOf(req) != null;
}

/**
 * «Guía del vendedor»: la guía que le compramos (o capturamos) al vendedor, visible mientras la solicitud viva y después.
 * Paquetería + número (copiable), rastreo y PDF por el proxy autenticado (`openLabelPdf`). Una guía a mano no tiene PDF.
 */
export function SellerGuideBlock({ requestId, inbound = null, manual = null, embedded = false }: { requestId: string; inbound?: AdminInboundShipmentDTO | null; manual?: ManualGuide | null; embedded?: boolean }) {
  const t = useTranslations('admin.m5.sellerGuide');
  const [err, setErr] = useState<string | null>(null);
  const canceled = inbound?.status === 'cancelado';
  // Cancelación sellada pero aún no confirmada por la paquetería: sin PDF y rotulada.
  const canceling = !!inbound && !canceled && !!inbound.providerCanceledAt && !inbound.cancelConfirmed;
  const isManual = manual != null || inbound?.labelSource === 'manual';
  const showPdf = !!inbound && inbound.labelSource === 'skydropx' && !canceled && !canceling;
  const number = manual?.trackingNumber ?? inbound?.trackingNumber ?? null;
  const carrier = manual ? manual.carrier : (inbound?.carrier ?? null);
  return (
    <section
      aria-label={t('title')}
      data-testid={`seller-guide-${requestId}`}
      className={embedded ? 'flex flex-col gap-2' : 'flex flex-col gap-2 border border-border-strong bg-surface-2 px-4 py-3'}
    >
      {!embedded && <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{t('title')}</p>}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="text-sm">
          <span className="text-muted">{t('carrier')}: </span>
          {carrier ?? '—'}
        </span>
        <span className="flex items-center gap-3 text-sm">
          <span className="text-muted">{t('tracking')}: </span>
          <span className="tabular font-mono">{number ?? '—'}</span>
          {number && <CopyButton text={number} label={t('copy')} copiedLabel={t('copied')} />}
        </span>
        {canceled && (
          <span data-testid="seller-guide-canceled" className="text-sm font-medium text-accent">
            {t('canceled')}
          </span>
        )}
        {canceling && (
          <span data-testid="seller-guide-canceling" className="text-sm font-medium text-accent">
            {t('canceling')}
          </span>
        )}
        {isManual && <span className="text-sm text-muted">{t('manual')}</span>}
      </div>
      {(safeHttpUrl(inbound?.trackingUrl) || showPdf) && (
        <div className="flex flex-wrap gap-2">
          {safeHttpUrl(inbound?.trackingUrl) && (
            <a
              href={safeHttpUrl(inbound?.trackingUrl) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center border border-border px-3 py-1.5 text-sm hover:bg-surface-2 focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t('track')}
            </a>
          )}
          {showPdf && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setErr(null);
                // `download` (no `print`): `window.open` tras el `await` lo bloquea el navegador; como en M4/CaptureLabelDialog.
                openLabelPdf(inbound.id, inbound.folio, 'download').catch((e) =>
                  setErr(asApiError(e)?.code === 'LABEL_NOT_AVAILABLE' ? t('notAvailable') : t('pdfError')),
                );
              }}
            >
              {t('pdf')}
            </Button>
          )}
        </div>
      )}
      {err && <p role="alert" className="text-sm text-accent">{err}</p>}
    </section>
  );
}
