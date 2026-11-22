'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { asApiError } from '@/lib/api-client';
import type { AdminInboundShipmentDTO } from '@/types/contract';
import { Button } from '@/components/ui/Button';
import { openLabelPdf } from '../m4/capture/label-pdf';
import { CopyButton } from './BuylistFlowParts';

/**
 * ¿Hay guía que mostrar? Desde que la guía existe (`guia`) o quedó cancelada; `solicitado` (sin guía todavía) no.
 */
export function hasSellerGuide(inbound: AdminInboundShipmentDTO | null | undefined): inbound is AdminInboundShipmentDTO {
  return inbound != null && inbound.status !== 'solicitado';
}

/**
 * «Guía del vendedor»: la guía que le compramos (o capturamos) al vendedor, visible mientras la solicitud viva y después.
 * Paquetería + número (copiable), rastreo y PDF por el proxy autenticado (`openLabelPdf`). Una guía `manual` no tiene PDF.
 */
export function SellerGuideBlock({ requestId, inbound, embedded = false }: { requestId: string; inbound: AdminInboundShipmentDTO; embedded?: boolean }) {
  const t = useTranslations('admin.m5.sellerGuide');
  const [err, setErr] = useState<string | null>(null);
  const canceled = inbound.status === 'cancelado';
  const manual = inbound.labelSource === 'manual';
  const showPdf = inbound.labelSource === 'skydropx' && !canceled;
  const number = inbound.trackingNumber;
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
          {inbound.carrier ?? '—'}
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
        {manual && <span className="text-sm text-muted">{t('manual')}</span>}
      </div>
      {(inbound.trackingUrl || showPdf) && (
        <div className="flex flex-wrap gap-2">
          {inbound.trackingUrl && (
            <a
              href={inbound.trackingUrl}
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
                openLabelPdf(inbound.id, inbound.folio, 'print').catch((e) =>
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
