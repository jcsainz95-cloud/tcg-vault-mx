'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { refreshShipmentTracking } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { useErrorMessage } from '@/components/ui/QueryState';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { formatDateTimeMx, formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type { AdminShipmentDTO, CarrierStatus } from '@/types/contract';
import { CancelLabelDialog } from './LabelActions';
import { openLabelPdf } from './capture/label-pdf';

/**
 * **La guía de Skydropx en la fila de «Envíos»** (`DESIGN_SYSTEM §43.8b` · contrato `§M4-SHIP.19.7–.10`):
 * guía, quién la compró, si era la recomendada, dinero, estado de la paquetería y su aviso, y las acciones
 * (imprimir, actualizar rastreo, cancelar y re-emitir). ⛔ Ninguna acción se pinta apagada: la que no aplica
 * no se pinta. «Capturar guía» NO existe en una fila con guía Skydropx (el servidor la rechazaría).
 */
export function SkydropxLabelBlock({ shipment }: { shipment: AdminShipmentDTO }) {
  const t = useTranslations('admin.m4.label');
  const tCarrier = useTranslations('admin.m4.carrierStatus');
  const tUnnamed = useTranslations('admin.m4.tracking.sdx.address');
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const label = shipment.label;
  if (!label) return null;
  const ref = shipment.orderNumber ?? shipment.id;
  const carrierStatusLabel = (s: CarrierStatus | null) => (s && tCarrier.has(s) ? tCarrier(s) : null);
  const status = carrierStatusLabel(label.carrierStatus);
  const cancellable = (label.carrierStatus === null || label.carrierStatus === 'created') && (shipment.status === 'picking' || shipment.status === 'guia');
  const money = (c: number) => formatMoneyCents(Math.abs(c), locale);

  return (
    <div className="flex flex-col gap-2 text-sm text-text" data-testid={`sdx-label-block-${shipment.id}`}>
      <p>
        {t('guide', {
          carrier: label.chosen.carrierLabel,
          service: label.serviceName,
          number: label.trackingNumber ?? t('noNumber'),
        })}
      </p>
      <p>{t('boughtBy', { name: label.chosenBy.name?.trim() || tUnnamed('unnamed'), datetime: formatDateTimeMx(label.purchasedAt, locale) })}</p>
      {!label.wasRecommended && label.recommended && <p>{t('notRecommended', { carrier: label.recommended.carrierLabel })}</p>}
      <p className="tabular">
        {t('cost', { cost: money(label.cost.grossCents) })} ·{' '}
        <span className={cn(label.cost.marginCents < 0 && 'text-accent')}>
          {t('margin', { margin: `${label.cost.marginCents < 0 ? '−' : ''}${money(label.cost.marginCents)}` })}
        </span>
        {(shipment.costAdjustments?.length ?? 0) > 0 && (
          <>
            {' '}
            {t('adjustments', { n: shipment.costAdjustments!.length })}{' '}
            <Link href="/admin/m10" className="underline underline-offset-4 hover:text-accent">
              {t('adjustmentsLink')}
            </Link>
          </>
        )}
      </p>
      <p>{status ? t('carrier', { status, date: formatDateTimeMx(label.carrierStatusAt, locale) }) : t('carrierNone')}</p>
      {shipment.carrierAlert && (
        <Banner variant="warning" role="status">
          <p>
            {t('alert', {
              status: carrierStatusLabel(shipment.carrierAlert.status) ?? shipment.carrierAlert.status,
              date: formatDateTimeMx(shipment.carrierAlert.at, locale),
            })}
          </p>
          {shipment.carrierAlert.detail && <p>“{shipment.carrierAlert.detail}”</p>}
          <p>{t('alertNote')}</p>
        </Banner>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setNotice(null);
            openLabelPdf(shipment.id, ref, 'print').catch((e) =>
              setNotice(asApiError(e)?.code === 'LABEL_NOT_AVAILABLE' ? t('notAvailable') : getError(e)),
            );
          }}
        >
          {t('print')}
        </Button>
        <RefreshButton shipmentId={shipment.id} onNotice={setNotice} />
        {cancellable && (
          <Button size="sm" variant="ghost" onClick={() => setCancelOpen(true)}>
            {t('cancel.cta')}
          </Button>
        )}
      </div>
      {notice && (
        <p role="status" className="text-sm text-text">
          {notice}
        </p>
      )}
      <CancelLabelDialog
        open={cancelOpen}
        variant="reissue"
        shipmentId={shipment.id}
        trackingNumber={label.trackingNumber ?? t('noNumber')}
        onClose={() => setCancelOpen(false)}
        onDone={(msg) => {
          setNotice(msg);
          void qc.invalidateQueries({ queryKey: ['admin-shipments'] });
        }}
      />
    </div>
  );
}

function RefreshButton({ shipmentId, onNotice }: { shipmentId: string; onNotice: (s: string | null) => void }) {
  const t = useTranslations('admin.m4.label');
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => refreshShipmentTracking(shipmentId),
    onSuccess: () => {
      onNotice(t('refreshed'));
      void qc.invalidateQueries({ queryKey: ['admin-shipments'] });
    },
    onError: (e) => {
      const err = asApiError(e);
      if (err?.status === 429) return onNotice(t('refreshTooSoon'));
      if (err?.code === 'FEATURE_DISABLED') return onNotice(t('refreshOff'));
      onNotice(getError(e));
    },
  });
  return (
    <Button size="sm" variant="ghost" loading={m.isPending} onClick={() => m.mutate()}>
      {t('refresh')}
    </Button>
  );
}
